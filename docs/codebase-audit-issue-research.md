# Codebase Audit Issue Research

Date: 2026-05-17

This document consolidates the final audit messages from these conversations:

- `019e3098-209c-7072-b5c5-9c148f205941`
- `019e3098-3eed-70e2-ad4c-e79eb88eda74`
- `019e3098-34a6-7570-90ac-1bf590b6769c`
- `019e3098-2a4e-7712-b253-db862219e711`
- `019e3098-1291-7dc3-81e3-afda539ceb71`

The purpose is to turn each extractable issue into an evidence-backed implementation plan. Every issue below must be grounded in local code, product docs, and the relevant pi or Smithers reference material before implementation work starts.

## Method

For each issue, record:

- **Audit source**: Which audit conversations raised it.
- **Current contract**: The exact product or external-reference behavior the code should satisfy.
- **Confirmed code path**: Files, functions, and control flow that currently implement or violate the contract.
- **Precise issue**: The smallest accurate statement of what is wrong.
- **Impact**: User-visible, reliability, security, performance, or product-doc consequence.
- **Best fix**: The cleanest, most reliable, optimized fix after researching the actual code.
- **Verification**: Unit, e2e, manual, or static checks needed to prove the fix.
- **Documentation updates**: PRD, features, progress, or specs updates required if behavior changes.

## Issue Index

| ID | Impact | Issue | Audit sources | Research status |
|---|---:|---|---|---|
| AUD-001 | Later | Host execution for `execute_typescript` and bash is not sandboxed | `3eed`, `2a4e`, `34a6` | Deferred |
| AUD-002 | P1 | `execute_typescript` exposes workflow APIs across actor surfaces | `3eed`, `2a4e`, `34a6`, `1291` | Researched |
| AUD-003 | P1 | Local browser-tools bridge exposes sensitive runtime state | all five | Researched |
| AUD-004 | Not accepted | Artifact file attachment and preview can escape workspace/artifact roots | `3eed`, `209c`, `1291` | Not convincing |
| AUD-005 | Not accepted | Raw command, tool, and artifact persistence can retain secrets without a unified redaction policy | `3eed`, `34a6`, `1291` | Logs-only redaction retained |
| AUD-006 | P1 | HTML artifact previews use `srcdoc` without an iframe sandbox | `34a6` | Fixed |
| AUD-007 | Not accepted | Duplicate same-cwd workspace tabs share workspace runtime and durable state while isolating only visual state | `209c`, `3eed`, `2a4e`, `34a6` | Intentional shared workspace runtime |
| AUD-008 | P1 | Workspace-scoped RPC handlers must never route through active runtime state | `209c`, `2a4e`, `1291` | Fixed |
| AUD-009 | P1 | Nonterminal Smithers workflow runs are not reliably reattached after restart | `209c`, `3eed`, `2a4e` | Fixed |
| AUD-010 | P1 | `smithers_run_workflow` can implicitly resume the wrong run when `runId` is omitted | `3eed`, `34a6`, `2a4e` | Fixed |
| AUD-011 | P1 | Smithers cancellation may leave inactive waiting runs stuck | `1291` | Fixed |
| AUD-012 | P1 | Project CI projection depends on in-memory terminal output and is not restart-safe | `1291` | Fixed |
| AUD-013 | P1 | Queued message drain can double-dispatch or strand `dispatching` rows after restart | `209c`, `34a6`, `2a4e`, `1291` | Fixed |
| AUD-014 | P2 | Queued-message reorder can spam durable writes during drag movement | `2a4e` | Fixed |
| AUD-015 | P1 | Handler `thread_handoff` reconciliation can be dropped while the orchestrator is active | `34a6`, `2a4e` | Fixed |
| AUD-016 | P1 | Initial handler auto-start handoff can fail to wake the orchestrator | `2a4e` | Fixed |
| AUD-017 | P1 | Prompt freshness is detected but not enforced before the next pi turn | `209c` | Fixed |
| AUD-018 | P1 | Session mode changes and new-session creation can use raw or double-wrapped system prompts | `1291`, `3eed` | Fixed |
| AUD-019 | P1 | Orchestrator and handler surfaces can inherit ambient pi extension tools beyond the actor contract | `34a6` | Adopted |
| AUD-020 | P1 | Workflow task-agent authoring contract, generated agent config, and runtime capability set can diverge | `209c`, `2a4e`, `1291` | Fixed |
| AUD-021 | P2 | Workflow task agents and extension loading do not fully match generated agent context binding semantics | `2a4e` | Fixed |
| AUD-022 | P1 | Dockview chat panels miss semantic transcript blocks and artifact/path callbacks | `34a6`, `2a4e`, `1291` | Fixed |
| AUD-023 | P2 | Artifact/static inspector panes remain focus-global instead of surface-owned | `3eed`, `209c` | Fixed |
| AUD-024 | P1 | Restart recovery can leave in-flight prompts, pending messages, running turns, or initial handler starts stale | `2a4e`, `34a6`, `209c` | Partially implemented |
| AUD-025 | P1 | Streaming assistant deltas emit full surface snapshots and reparse too much Markdown | all five | Fixed |
| AUD-026 | P1 | Workflow inspector live mode polls and rebuilds too much state | `34a6`, `2a4e`, `3eed`, `1291` | Researched |
| AUD-027 | P1 | Structured-state selectors materialize large snapshots with insufficient indexes/read models | `2a4e`, `34a6`, `209c`, `3eed` | Researched |
| AUD-028 | P2 | Native command-palette shortcut payload shape breaks app-menu accelerators | `34a6`, `209c` | Researched |
| AUD-029 | P2 | Command palette results and routes are incomplete for handler/task/Logs/Context/Project CI flows | `34a6`, `209c`, `1291` | Researched |
| AUD-030 | P1 | Destructive Delete Session conflicts with archive-as-hide product semantics | `1291`, `2a4e` | Researched |
| AUD-031 | P2 | E2E and proof tests encode retries, live-provider dependencies, brittle selectors, or missing restart paths | all five | Researched |
| AUD-032 | P2 | `docs/progress.md` and feature status tracking drift from shipped implementation | all five | Researched |
| AUD-033 | P2 | Smithers approval, task-attempt, and artifact shapes may drift from native Smithers contracts | `34a6`, `209c` | Fixed |
| AUD-034 | P2 | Minor UI and observability edge cases need confirmation: layout slot hydration, inspector split targets, log related links, double-click rename, private URL guards, provider secret storage | `209c`, `2a4e`, `34a6` | Researched; split into AUD-034A-F |

## Cross-Check Addendum

After compaction, the source audit transcripts and research subagent final messages were re-extracted from local Codex JSONL logs and compared against this document. The researched AUD-001 through AUD-034 sections cover every issue that had a dedicated research subagent output. The original five audit finals also contained meta guidance, scoring, and several source-only highlights that were not individually researched in the second pass. Those are preserved here so they are not lost.

### Aggregate Audit Scores

The five source audits used slightly different scoring scales, but the combined signal was consistent:

- **Architecture consistency:** mostly 5/10 to 7/10. The pi-backed orchestrator/handler/Smithers shape is visible, but workspace identity, actor capability boundaries, prompt lifecycle, and Smithers resume semantics drift.
- **Reliability/resume:** mostly 4/10 to 5/10. Durable state exists, but queue claims, active prompt recovery, initial handler starts, Smithers reattach/cancel, Project CI projection, and restart paths are the main weakness.
- **Test quality:** mostly 5/10 to 6/10. Unit coverage is broad, but e2e/proof tests include retries, force clicks, live-provider gates, stale delete assertions, and missing restart/resume paths.
- **UX/product clarity:** mostly 5/10 to 7/10. Dockview, logs, command palette, and inspectors are substantial, but missing semantic transcript cards, incomplete palette routes, artifact ownership, and related-link gaps can confuse users.
- **Performance risk:** mostly 6/10 to 8/10 risk. The repeated concerns were full snapshot streaming, Markdown reparsing, workflow inspector polling/rebuilds, broad SQLite selectors, app-log aggregation, path-index churn, registry refresh churn, and sync scans.
- **Security/privacy risk:** mostly 7/10 to 8/10 risk, with one audit scoring 4/10 but still listing high-leverage risks. Repeated concerns were bridge exposure, incomplete `execute_typescript` approval and sandbox boundary implementation, arbitrary artifact file reads, HTML preview sandboxing, provider secrets, private URL validation, and redaction gaps.

### Do Not Change Casually

The source audits repeatedly called out these intentional product directions:

- Keep pi as the interactive runtime/session substrate. Do not introduce a standalone shell, alternate TUI loop, or svvy-owned terminal runtime.
- Keep the orchestrator/handler/task-agent actor split. Fix leaks rather than flattening all actors into one global capability set.
- Keep Smithers as the workflow execution/runtime surface. Do not replace Smithers-native control with a parallel `workflow_*` control abstraction.
- Keep repo-root `workflows/` as an authoring workspace, not the shipped runtime or registry.
- Keep structured session state as the product read model. The issue is scoping, recovery, and read-model efficiency, not the existence of structured state.
- Keep Dockview as the renderer workbench/layout engine. The fix direction is stronger surface ownership and restoration, not a return to bespoke pane state.
- Keep workflow-task agents using task-local direct tools with extension gating. The issue is aligning contracts and runtime behavior, not removing the separate task-agent layer.

### Product Decisions And Open Questions Preserved From Source Audits

Resolved product decisions:

- The browser-tools bridge is dev/e2e/manual-inspection only. Shipped production builds must not mount browser-tools bridge behavior, and the dev/e2e/manual-inspection lane does not require an additional auth token.
- Duplicate same-cwd workspace tabs remain a shipped requirement as separate visual views over the same workspace runtime and durable workspace state. The UI must not prevent duplicates just to manufacture independent runtimes or isolated durable state.

Open product questions:

- Is `execute_typescript` meant to be a trusted full-process escape hatch, or a constrained API-only sandbox?
- Should `execute_typescript` be available to the orchestrator at all, or only to handler/task-agent contexts?
- Should workflow task-agent `toolSurface` be product-configurable, or should the contract define one fixed surface?
- Should workflow-authored task agents expose a small factory API, or should all task-agent creation go through generated workflow components?
- Should destructive session deletion exist at all, or should archive/unarchive be the only user-visible deletion model?
- Should Project CI palette commands target the focused handler thread when one is focused, or always route through orchestrator policy?
- Should provider secrets move to OS credential storage before broader distribution?
- Should direct coding tools be whole-filesystem by policy, or should svvy add workspace confinement above pi?
- Should `smithers_resolve_approval` mirror Smithers' richer native payload exactly, or preserve a simplified svvy affordance? This conflicts with the current Smithers-native direction and should be resolved explicitly if simplified shapes are kept.

### Source-Only Highlights Requiring Follow-Up

The items below were highlighted by source audit finals or source audit subagent rosters but did not receive dedicated second-pass research sections. They should not be treated as fully proven implementation tasks until confirmed against code.

- **Unread clearing and log read-state gaps:** Mentioned in renderer/UI audit summaries. AUD-032 confirms durable unread state exists and progress docs drift, while AUD-034E covers app-log related links. A follow-up should verify unread clearing, log read-state transitions, and whether any open/read events fail to mark the correct surface/log entries seen.
- **Provider preflight and renderer-side custom key handling:** Mentioned by UI/security audit summaries. AUD-034B covers provider credential storage and precedence, but a follow-up should inspect provider readiness/preflight UI and any renderer-side handling of custom provider keys.
- **Per-workspace `.env` gap:** Mentioned by a persistence/restart audit roster. This needs confirmation against provider/env resolution and workspace-runtime scoping before becoming an implementation issue.
- **Dropped compaction events:** Mentioned by a pi/reference audit roster. AUD-024 covers restart and stale running work generally, but compaction event persistence/replay needs a dedicated check against pi integration and structured state.
- **Missing `thread_start` runtime guard:** Mentioned by an actor-surface audit roster. AUD-019 covers ambient pi extension leakage and actor tool-surface isolation. A follow-up should verify that handlers cannot dynamically invoke `thread_start` through any runtime/code-mode path.
- **Repo-root workflow registry asset leakage:** Mentioned by a Smithers audit roster. AUD-020/AUD-033 cover task-agent and Smithers contract drift, but packaged workflow discovery should be checked specifically for source-checkout-relative registry assets.
- **Panel release gaps:** Mentioned by renderer audit summaries. AUD-023 covers focus-global artifact/static inspector state, but pane close/release reference counting should be checked separately for leaked or prematurely disposed live surfaces.
- **Fabricated workflow progress:** Mentioned by a renderer audit roster. AUD-022 and AUD-026 cover transcript and workflow inspector projection, but a follow-up should verify whether any UI progress display is inferred rather than derived from durable Smithers/structured state.
- **Additional performance hotspots:** Registry refresh churn, app-log aggregation, path-index churn, log burst cost, and sync scans were called out in audit summaries. AUD-025 through AUD-027 cover the largest performance issues, but these named paths need targeted profiling or static confirmation before implementation.
- **Workflow rename state:** Mentioned in progress drift summaries. AUD-032 covers progress/docs drift, but workflow rename shipped state should be verified before ticking or rewriting progress items.

### Smithers-Native Follow-Ups From AUD-011 Exploration

These are not AUD-011 regressions. They are adjacent places where `svvy` was still rolling custom workflow-control logic. They were pulled forward into the Smithers-native refactor tracked by AUD-020 and AUD-033:

- **Approval resolution:** `smithers_resolve_approval` now mirrors Smithers approval semantics and payloads, including native approve/deny behavior, instead of preserving a simplified svvy-only decision shape.
- **Run watching:** `smithers_watch_run` now delegates through the Smithers-native adapter instead of maintaining a separate svvy control-plane shape.
- **Inspection result shapes:** `smithers_get_node_detail`, `smithers_list_artifacts`, transcript, event, and related inspection tools now pass through native Smithers read-model fields unless the product exposes a separate svvy-specific projection.
- **Task-attempt identity:** Workflow task-attempt records now bind to exact Smithers run, node, iteration, and attempt identity rather than recency-style resume-handle lookup.
- **DevTools streaming:** `smithers_stream_devtools` now uses the Smithers-native stream cursor path. The broader renderer inspector delta work remains AUD-026.

### Resolved Design Boundary For Smithers Execution Facts

This is the adopted implementation boundary for Smithers execution facts.

Smithers execution facts stay in Smithers only. That includes:

- run lifecycle and raw run event history
- node state
- iteration and attempt state
- workflow task-agent attempt lifecycle, retry state, transcript, usage, tool steps, output validation, schema repair, and hijack continuation
- waits, signals, approvals, approval decisions, and timers
- node output, partial output, final output, validated output, artifacts, frames, and event detail

`svvy` stores product facts around those Smithers facts:

- workspace/session/thread/surface ownership
- Smithers run id and exact Smithers node/iteration/attempt identifiers for UI projection rows
- runnable-entry and product-lane binding, including Project CI entry identity
- handler-attention cursors and delivery state
- product statuses, troubleshooting summaries, sidebar badges, explicit panel targets, and related links
- command/artifact projections created by svvy direct tools
- Project CI `ci_run` and `ci_check_result` rows derived from declared CI entries after reading durable Smithers terminal result output

Smithers events, monitor reconnects, app restart recovery, and Smithers-native tool results are triggers for `svvy` projection work. They must cause targeted re-reads of Smithers durable state by Smithers identifiers before `svvy` updates product projection rows. `svvy` must not rebuild or authoritatively persist Smithers run, node, attempt, wait, approval, timer, output, or event state from its own projection rows.

### Source Provenance And Commands

The cross-check used these local transcript files as source material:

- `/Users/polarzero/.codex/sessions/2026/05/16/rollout-2026-05-16T13-42-16-019e3098-209c-7072-b5c5-9c148f205941.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/16/rollout-2026-05-16T13-42-24-019e3098-3eed-70e2-ad4c-e79eb88eda74.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/16/rollout-2026-05-16T13-42-21-019e3098-34a6-7570-90ac-1bf590b6769c.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/16/rollout-2026-05-16T13-42-19-019e3098-2a4e-7712-b253-db862219e711.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/16/rollout-2026-05-16T13-42-13-019e3098-1291-7dc3-81e3-afda539ceb71.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-25-019e3655-b015-7592-8632-e8c8853c1d58.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-30-019e3655-c2da-72d2-ab49-2a07bcc90c6d.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-35-019e3655-d5c2-7800-b8a3-f98cc0ac3443.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-40-019e3655-e7fd-7a22-87d0-a67e50f1c14a.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-45-019e3655-fe0c-7d52-8699-907e801d5558.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-50-019e3656-1137-76d0-bc84-864ef2ae0510.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-27-55-019e3656-2349-7600-845c-66ee21ce18e1.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-28-02-019e3656-3d7d-7f50-a48e-8927a4ca8f2a.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-28-06-019e3656-4f23-7e80-be81-1da554cb96fb.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-28-11-019e3656-611f-74a3-be24-eb09a1d6dea7.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-28-15-019e3656-7211-7913-9f28-9e8dde2d1868.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-28-20-019e3656-84d0-71e2-8e74-38ed0ea74629.jsonl`
- `/Users/polarzero/.codex/sessions/2026/05/17/rollout-2026-05-17T16-28-25-019e3656-9747-7362-8c80-86f003cd92cc.jsonl`

The original audits reported mixed command outcomes: several `bun run check` runs passed, one failed in `format:check` but then passed on rerun, and some failed during `test:unit` with a workflow-supervision proof flake. The document creation pass later ran `bun run check` successfully after adding this docs file.

## Researched Issues

### AUD-001 - Host execution for `execute_typescript` and bash is not sandboxed

**Disposition:** Deferred. This is a valid host-execution hardening concern, but it is not an immediate product fix. For now, `svvy` treats both `execute_typescript` and bash-style command execution as trusted local coding-agent capabilities rather than sandboxed untrusted-code surfaces.

**Impact:** Future security and auditability concern. `execute_typescript` presents a constrained TypeScript API, but runtime execution can still reach host globals and perform operations outside the declared `api` surface. Bash commands have the same broad host-execution character by design.

**Precise issue:** `src/bun/execute-typescript-tool.ts` typechecks and transpiles snippets, then runs the emitted JavaScript through `new Function(...)`. The generated declaration and prompt say that snippets should use the injected `api` object and should not rely on Node or Bun built-ins, but that is only a type/prompt contract. It is not a runtime boundary.

The audit probe confirmed that snippet code can reach host objects:

- `Function("return process")().cwd()` returns the repository cwd.
- `Function("return globalThis.Bun")().file("docs/prd.md").exists()` can access Bun file APIs.

Relevant code:

- `src/bun/execute-typescript-tool.ts`: host-side typecheck/transpile around the execution pipeline.
- `src/bun/execute-typescript-tool.ts`: runtime execution via `new Function(...)`.
- `src/bun/default-system-prompt.ts`: prompt-only instruction that code should use the provided API.

**Why this matters later:** TypeScript checking prevents some undeclared names at compile time, but JavaScript dynamic evaluation still reaches host capabilities. If `svvy` later needs to treat agent code or shell commands as untrusted, the current model is not enough: file, process, network, or other host operations can happen without going through a narrow recorded generated-client call surface.

**Later fix:** Design one host-execution confinement model that covers both `execute_typescript` and bash.

The clean long-term fix is a real execution boundary:

1. Keep typechecking/transpilation in the trusted Bun process.
2. Execute compiled snippets in a constrained subprocess, worker isolate, or OS sandbox with a minimal global object.
3. Expose only the allowed generated `extensions["<id>"].run(...)` capabilities through an RPC bridge from the sandbox to the host.
4. Validate every RPC call against the current actor's capability profile before performing host work.
5. Record host-side effects from that RPC layer, not from snippet-side assumptions.

Do not rely on deleting globals from the current realm, prompt text, TypeScript declarations, lexical wrappers, or command allowlist prose. Those are not a durable security boundary against dynamic evaluation or shell execution.

**Future verification required:**

- Unit tests where snippets try `Function("return process")`, `globalThis.Bun`, `eval`, dynamic imports, and constructor escapes; all must fail without host side effects.
- Tests showing allowed generated extension-client calls still work and are recorded.
- Regression tests for current typecheck behavior, artifact APIs, child-command APIs, and web APIs.
- A destructive-operation guard test proving denied snippets do not spawn child commands or write files.

**Documentation impact:** No immediate PRD/spec change is needed. If sandboxing becomes a product requirement later, update the relevant execution/tool specs to describe the shared host-execution boundary for both TypeScript snippets and bash.

**Confidence:** High. The runtime escape was directly confirmed.

### AUD-002 - Actor-scoped workflow API leaks through `execute_typescript`

**Impact:** Critical capability-boundary issue. Actors that should not receive workflow discovery or Smithers control can reach workflow APIs from code mode.

**Current contract:** `execute_typescript` is actor-local. The orchestrator receives `execute_typescript` for bounded local composition, but it does not receive workflow discovery, Smithers runtime control, or any loaded-extension client absent from its actor binding; it delegates workflow action by calling `thread_start`. Handler threads receive the workflow and Smithers capability set defined by the product contract: loaded Workflows extension generated clients for typed composition over workflow assets and authoring models, and direct `smithers_*` tools for runtime supervision. Workflow task agents receive only task-local direct-tool APIs through `execute_typescript` and do not receive workflow discovery, Smithers supervision, handler/orchestrator control, or handler-only extension clients.

**Precise issue:** The top-level capability set is actor-scoped, but the generated `execute_typescript` SDK and runtime API were not.

Relevant code:

- `src/bun/session-catalog.ts`: workflow capabilities are withheld from the orchestrator top-level capability set and added for handler surfaces.
- `src/bun/default-system-prompt.ts`: builds one execute TypeScript SDK for all actors.
- `src/bun/execute-typescript-api-contract.ts`: included workflow helpers in every actor declaration.
- `src/bun/execute-typescript-tool.ts`: always registers workflow tools inside code mode.

The audit probe confirmed an orchestrator-context `runExecuteTypescript` call could invoke workflow discovery through the old generated helper API.

**Why this matters:** The product contract separates orchestrator, handler, and task-agent powers. Handler agents may discover workflow assets through handler-owned generated extension clients and supervise Smithers through direct `smithers_*` tools. Orchestrators and task agents should only see the capabilities explicitly granted to them. `execute_typescript` must not bypass that separation.

**Best fix:** Make `execute_typescript` actor-aware at both declaration time and runtime.

1. Define an explicit capability profile for each actor type.
2. Pass that profile into `buildExecuteTypescriptApiDeclaration`.
3. Pass the same profile into `createExecuteTypescriptTool`, `runExecuteTypescript`, and `createExecuteTypescriptApi`.
4. Only generate loaded-extension declarations for actor contexts that have that extension loaded.
5. Do not generate any broad Smithers helper namespace; handlers supervise Smithers through direct `smithers_*` tools and the loaded Smithers extension contract.
6. Reject runtime calls whose namespace is absent from the actor capability profile, even if malicious code constructs the call dynamically.

The declaration and runtime guard must use the same source of truth. Declaration-only filtering would still be bypassable through dynamic JavaScript.

**Verification required:**

- Prompt/declaration tests proving handler-only workflow clients are absent for orchestrators and workflow task agents.
- Prompt/declaration tests proving workflow clients are present for handlers when the Workflows extension is loaded.
- Prompt/declaration tests proving no actor receives a broad Smithers helper namespace.
- Runtime tests proving dynamic access to blocked namespaces fails.
- Runtime tests proving handler workflow discovery calls still work through loaded generated extension clients.

**Documentation impact:** Update the execute TypeScript spec if it currently describes one universal SDK. The actor-scoped contract should be explicit.

**Confidence:** High. The top-level actor scoping and code-mode leak were both identified in source, and the orchestrator code-mode call was confirmed.

### AUD-003 - Browser-tools bridge must stay out of production

**Impact:** Critical local attack-surface and data-exposure issue if browser-tools behavior is present in production.

**Decision:** The `electrobun-browser-tools` bridge is only for development, OrbStack e2e, and manual inspection. The production app path must contain no browser-tools bridge behavior. Because the bridge is non-production-only, svvy does not require an additional dev auth token or bearer-token model for that lane.

**Precise issue:** Current code mounts the `electrobun-browser-tools` bridge on a predictable local port derived from process id. The bridge exposes read and write inspection/control methods intended for automation and manual inspection. That is acceptable only in explicitly enabled dev/e2e/manual-inspection contexts, not in shipped production behavior. The app also records or prints the resolved bridge URL, which should remain limited to the non-production inspection lane and must not be treated as normal app-log observability.

Relevant code:

- `src/bun/tool-bridge.ts`: builds bridge state including cwd, open workspaces, provider auth summaries, session summaries, surfaces, and system prompts.
- `src/bun/tool-bridge.ts`: mounts the bridge on `59000 + (process.pid % 1000)`.
- `node_modules/electrobun-browser-tools/dist/chunk-VKPXYR7I.js`: handles bridge GET/POST requests without bearer-token validation.
- `src/bun/index.ts`: records bridge events/logs including the resolved bridge URL.

**Why this matters:** If browser-tools behavior is present in production, any local process that discovers the port can inspect and drive the app. Depending on browser loopback/private-network behavior, browser-origin access may also be relevant. The bridge state is not limited to harmless liveness information; it includes sensitive operational metadata and rendered UI state. Provider keys were not confirmed to be in the bridge state, but password input values can be read by DOM tools while a user is editing them.

**Best fix:**

1. Exclude browser-tools mounting, request handlers, state capture, and URL logging from shipped production builds.
2. Keep browser-tools available only through explicit dev/e2e/manual-inspection launch paths.
3. Do not add a bearer-token or dev-auth requirement for the non-production inspection lane.
4. Keep browser-tools URL output and state capture scoped to non-production inspection workflows, not product app logs.
5. Reduce non-production bridge state to the minimum needed for inspection. Replace raw prompt text and sensitive metadata with hashes, labels, or redacted summaries where inspection does not need the raw value.
6. Mask password and token field values in DOM/state bridge output.

**Verification required:**

- Production/default launch does not mount browser-tools routes, request handlers, or state-capture behavior.
- Dev/e2e/manual-inspection launch paths can still use `electrobun-browser-tools` without additional auth.
- Product app logs do not include browser-tools URL output and do not treat browser-tools telemetry as normal production observability.
- Non-production bridge snapshots do not include raw system prompts or password/token input values unless a specific inspection task intentionally requires that raw field and documents the exposure.

**Documentation impact:** Keep the app-log spec clear that browser-tools telemetry is outside production observability. Keep `AGENTS.md` guidance for manual inspection aligned with the non-production-only bridge lane and no dev auth/token requirement.

**Confidence:** High for unauthenticated local bridge and URL logging in the current inspection path. Browser-origin reachability matters only for the non-production lane once production excludes browser-tools behavior.

### AUD-004 - Artifact paths are not contained to the workspace artifact area

**Disposition:** Not accepted as currently argued. The concern that path-based artifact preview can read outside the workspace is real as a mechanism, but the audit does not yet establish why external file references are improper product behavior for a local coding app. The proposed managed-copy-only policy would change artifact semantics and may make legitimate references to files outside the workspace harder without proving a concrete product risk.

**Impact:** Unproven. This may be a product-design question about whether artifacts are allowed to reference external local files, not a confirmed P1 bug.

**Precise issue:** Artifact creation and preview paths can persist arbitrary absolute or process-relative paths. Inline artifact content is written under an artifact root, but attached path-based artifacts are stored and later read without canonical containment checks.

Relevant code:

- `src/bun/svvy-direct-tools.ts`: `artifact.create` stores `input.path` directly.
- `src/bun/structured-session-state.ts`: accepts and resolves artifact paths without enforcing an artifact root for path-only artifacts.
- `src/bun/session-catalog.ts`: reads artifact preview content from `artifact.path`.
- `src/bun/structured-session-selectors.ts`: checks existence at `artifact.path`.

**Why this matters:** A tool call can point an artifact at an arbitrary file on disk. Later preview/read paths can expose that file as if it were a generated artifact. Relative paths are also dangerous because they resolve against process cwd rather than a declared artifact root.

**Rejected fix for now:**

1. Centralize artifact path resolution in one module.
2. Define the only allowed persisted artifact path roots, preferably `.svvy/artifacts/<session-id>/...` or the existing canonical artifact store.
3. Reject absolute paths, `..` traversal, and process-relative paths for persisted artifact records.
4. Resolve and `realpath` both the candidate path and allowed root, then enforce root containment after symlink resolution.
5. For `attach_file` or path-based artifact evidence, copy the file into the managed artifact root and persist the copied path.
6. Store the original source path only as redacted provenance metadata, not as the preview/read target.
7. Make preview/read APIs refuse any stored artifact path that is outside the allowed root, even for legacy records.

**Verification that would be required if reopened:**

- Absolute outside path is rejected.
- `../` traversal is rejected.
- Symlink escape from the artifact root is rejected.
- Valid attached files are copied into the managed artifact root and previewed from there.
- A malicious pre-existing database record pointing outside the root is refused by preview/read code.

**Documentation impact:** None for now. Reopen only if a clearer product rule is adopted, such as "artifact previews must only read app-owned generated outputs" or "external file references must require an explicit user action."

**Confidence:** Low as a product issue. The code path exists, but the risk argument and intended artifact semantics need a better justification before implementation.

### AUD-005 - Redaction is app-log-specific and does not cover command, tool, artifact, and obsolete provider-backed web records

**Disposition:** Not accepted as a product issue for now. `svvy` redacts app logs because logs are designed to be copied and shared for support/debugging. Other durable records, such as commands, tool inputs/results, snippets, artifacts, and web outputs, are local product state whose value often depends on preserving exact content. A broad shared redaction policy would be unreliable and could corrupt the records users expect the app to retain.

**Web note:** The provider-backed Web implementation referenced below is obsolete under
`docs/specs/extension/web.extension.spec.md`. Web v1 is prompt-only TinyFish CLI guidance and does not define
`svvy`-owned Web fetch artifacts or Web provider output persistence. The Web-specific part of this
audit entry is historical evidence only unless a later product decision adopts a new native or
provider-backed Web surface.

**Impact:** Accepted only for app logs. Broader persistence redaction is not currently required.

**Precise issue:** The app has an app-log redactor, but command summaries, command facts, tool execution records, `execute_typescript` snippets/logs/errors, artifact content, and older provider-backed web fetch outputs are not consistently passed through a shared sensitive-data policy before persistence or display.

Relevant code:

- `src/bun/app-log-store.ts`: app-log redaction policy.
- `src/bun/structured-session-state.ts`: persists command summaries, facts, errors, and related records.
- `src/bun/tool-execution-command-tracker.ts`: stores raw generic tool args/results.
- `src/bun/execute-typescript-tool.ts`: records snippets, logs, errors, and facts.
- `src/bun/svvy-direct-tools.ts`: writes artifact text/json content.
- `src/bun/web-runtime/providers/shared.ts`: older provider-backed Web path that wrote web
  bodies/metadata without the app-log redactor; obsolete under Web v1.

**Why this was not accepted:** Users can paste API keys, bearer tokens, provider responses, auth headers, or private data into commands and tool calls. Those values can land in SQLite, artifact files, inspectors, previews, and exports. That is expected local app state unless the surface is specifically designed for sharing. App logs are the sharing-oriented surface and should stay redacted; applying heuristic redaction everywhere else is not reliable enough to justify the data loss.

**Rejected fix for now:**

1. Extract a shared sensitive-data redaction module used by every persistence/display path that records tool input, tool output, command facts, command summaries, errors, web metadata, and automatic execution artifacts.
2. Apply redaction before writing to SQLite and before emitting renderer-facing snapshots.
3. Keep an explicit distinction between user-authored artifact content and automatically captured execution evidence. User-authored artifacts may need exact bytes; automatic evidence should default to redacted previews.
4. Redact common secret shapes, provider keys, auth headers, bearer tokens, cookies, private URLs with embedded credentials, and environment-variable style secrets.
5. Make path redaction conservative: preserve useful file names/cwd context where safe, but redact secret-like path segments and credentials.

**Verification that would be required if reopened:**

- Inject fake secrets into bash commands, tool args, tool output, command facts, `execute_typescript` console logs, thrown errors, artifact writes, and web metadata.
- Assert persisted snapshots and renderer projections redact those secrets.
- Assert intentional user-authored artifact content behavior is documented and tested.
- Assert redaction does not corrupt non-secret structured fields required by inspectors.

**Documentation impact:** None for now unless specs imply all durable state is redacted. Keep app-log specs clear that app logs are the redacted support/debugging surface.

**Confidence:** High in the decision. Broader redaction is technically possible only heuristically and is not currently a product requirement.

### AUD-006 - Visible HTML artifact previews are sandboxed

**Disposition:** Fixed. Visible HTML artifact previews use sandboxed iframes. Script-capable previews grant only `allow-scripts`; the sandbox does not grant same-origin access, top navigation, popups, or form submission.

**Impact:** High renderer security issue when absent; resolved by the sandboxed preview contract.

**Resolved contract:** HTML artifact content is untrusted renderer input. Visible HTML previews must render inside a sandboxed iframe. Script-capable previews may use `allow-scripts`, but the preview sandbox must not include `allow-same-origin`, `allow-top-navigation`, `allow-popups`, `allow-forms`, or equivalent escape permissions by default.

**Original issue:** The artifact contract said HTML artifacts run in a sandboxed preview. The hidden iframe used for log capture had `sandbox="allow-scripts"`, but the visible artifact preview iframe used `srcdoc` without a sandbox attribute.

Relevant code:

- `src/mainview/artifacts.ts`: builds artifact preview documents and uses a hidden sandboxed iframe for log capture.
- `src/mainview/RelatedInspectorPane.svelte`: explicit artifact inspector panes render visible HTML previews through `srcdoc` and a sandbox attribute.
- `e2e/transcript-artifacts.test.ts`: covers HTML artifact preview/log behavior; sandbox-attribute coverage belongs with artifact preview regression tests.

**Why this matters:** An unsandboxed `srcdoc` iframe normally shares origin with the parent document. Malicious generated HTML can access parent DOM, inspect app state, or modify UI unless browser/electrobun embedding behavior prevents it. The product contract should not depend on that accidental behavior.

**Fixed behavior:** The visible preview iframe is sandboxed. Script-capable previews grant only script execution and do not include same-origin, top-navigation, popup, or form permissions.

**Verification:**

- Component/e2e test asserting the visible iframe has the expected sandbox attribute, currently covered by `src/mainview/related-inspector-pane.test.ts`.
- Malicious HTML fixture that tries to read or mutate `parent.document`; parent state must remain unchanged.
- Regression test that ordinary HTML artifact scripts still run inside the preview.

**Documentation impact:** The PRD, feature inventory, structured-state spec, and workspace-navigation artifact projection spec define the sandboxed HTML preview policy.

**Confidence:** High.

### AUD-007 - Duplicate same-cwd workspace tabs share runtime and durable state

**Disposition:** Not accepted as a bug. Duplicate tabs for the same cwd are intentionally multiple visual tabs over the same workspace runtime and durable workspace state. They should share sessions, pi session files, structured state, queues, thread state, workflow state, and other workspace-owned runtime data. They should not share visual/layout state such as Dockview layout, opened panels, scroll positions, focused pane, and other per-tab view state.

**Impact:** Documentation/contract clarification only. The issue is not that same-cwd tabs share durable state; the product rule is that only visual state is isolated per tab.

**Current contract:** Opening the same cwd in two tabs creates two visual tab entries over one workspace runtime identity. Both tabs use the same session directory, structured SQLite database, pi sessions, thread surfaces, queues, catalog sessions, workflow state, and app log stream. The visual tab entry owns only view-local state.

Relevant product surfaces:

- Workspace shell: duplicate same-cwd tabs are separate visual entries and restore separate tab order, active layout slot, Dockview layout, opened panels, panel-local scroll, focus, and explicit static pane targets.
- Workspace runtime: duplicate same-cwd tabs share the runtime identity, session catalog, live surface registry, app logs, pi sessions, structured state, queues, threads, workflow runs, and workspace read models.
- Workspace-scoped RPC: user work routes through the shared runtime `workspaceId`; view-local updates also carry a tab or view id.

**Why this was not accepted:** One tab's sessions, queues, prompt locks, managed surfaces, workflow runs, or thread state appearing in another same-cwd tab is intended. The only unacceptable sharing is view-local state, because duplicate tabs are separate visual workspaces over the same underlying cwd runtime.

**Verification to preserve the intended contract:**

- Open the same cwd twice and assert both tabs share the same backend workspace runtime, durable sessions, structured workspace state, live surface registry, thread/workflow state, prompt queues, and app logs.
- Assert visual state is tab-specific: Dockview layout, opened panels, scroll positions, focused pane, and similar view-local state do not leak between duplicate tabs.
- Keep or strengthen tests that codify duplicate-tab durable sharing.

**Documentation impact:** Update PRD/features/spec wording where needed so "duplicate same-cwd workspace tabs" means shared workspace runtime/state with isolated visual layout state.

**Confidence:** High in the product decision.

### AUD-008 - Workspace-scoped RPC must not use the active runtime

**Impact:** High multi-workspace correctness issue.

**Disposition:** Fixed. Workspace-scoped backend handlers and renderer call sites now carry and honor explicit `workspaceId` for workspace-affecting operations, and regression coverage verifies that a request targeting workspace A still mutates workspace A while workspace B is active.

**Accepted contract:** Workspace-scoped RPC must never route through the active workspace, active runtime, focused tab, or focused panel. Background work can continue while another workspace tab is focused, so every read or mutation of workspace state must resolve the target runtime from an explicit `workspaceId` carried by the request. App-global settings are separate and must not pretend to be workspace-scoped. Workspace-affecting settings and prompt/workflow-library operations must carry explicit `workspaceId` because they read workspace-local prompt projection, generated context, workflow assets, or write files such as `.svvy/workflows/components/agents.ts`.

**Original issue:** Some backend handlers received workspace-scoped requests but resolved the active runtime instead of the request's workspace id. Prompt-library calls were the clearest confirmed case. Some settings/workflow-agent paths were also active-runtime based and needed classification into app-global versus workspace-affecting behavior.

Relevant code:

- `src/shared/workspace-contract.ts`: requires `workspaceId` on workspace-affecting Agents/Extensions and settings requests.
- `src/mainview/Settings.svelte`: passes the active workspace tab id into workspace-affecting settings calls instead of relying on backend focus.
- `src/bun/index.ts`: routes workspace-affecting handlers through `getWorkspaceRuntime(input)` rather than `getActiveRuntime()`.
- `src/bun/workspace-rpc-routing.ts`: centralizes request-based runtime lookup and workspace-id stripping.
- `src/bun/workspace-runtime-registry.test.ts`: covers requests targeting workspace A while workspace B is active.

**Why this matters:** In a multi-workspace app, a non-active workspace request can mutate or read the active workspace. Prompt libraries, generated/external sources, workflow-agent generated files, and settings that write workspace files can land in the wrong cwd. The focused workspace is view state, not a routing authority.

**Fixed behavior:**

1. Workspace-scoped RPC routes through `getWorkspaceRuntime(input)` or equivalent request-based lookup.
2. Workspace-affecting settings and prompt/workflow-library operations require `workspaceId`.
3. Renderer settings calls carry the target workspace id explicitly.
4. Active-runtime lookup remains only for focus-owned or inspection-oriented behavior such as app lifecycle fallback logging, open-workspace dialog defaults, unscoped app-log query fallback, provider-auth logging, and dev browser-tools active workspace inspection.

**Verification:**

- Open workspace A and B, make B active, send a workspace-scoped settings/session mutation to A, and assert only A changes.
- Prompt-library reads, writes, snapshots, generated entries, and external sources route through the requested `workspaceId`.
- Workflow-agent component sync writes to the requested workspace, not the active workspace.
- For Workflows library reads, deletes, open-in-editor, validation refreshes, and save-shortcut routing, assert the requested workspace is used even when another workspace is focused.
- For app-global settings such as model provider credentials, app appearance, external editor, and
  app-wide session-agent defaults, assert no active-workspace runtime lookup is required.
- Renderer tests proving scoped calls retain workspace id.

**Documentation impact:** PRD, feature inventory, Agents/Extensions prompt composition spec, workflow-library spec, multi-session runtime spec, and progress docs state the explicit `workspaceId` routing contract and the app-global versus workspace-affecting settings split.

**Confidence:** High.

### AUD-009 - Nonterminal Smithers runs are reattached after restart

**Impact:** High workflow reliability issue.

**Disposition:** Fixed in `src/bun/session-catalog.ts` and `src/bun/smithers-runtime/manager.ts`.

**Current contract:** On app start or session restoration, `svvy` finds workflow runs that are not known terminal or still have undelivered handler attention, bootstraps each run from Smithers durable state, resumes same-run execution for active `running` Smithers runs with explicit `runId`, and re-emits durable handler attention for approval, signal, and terminal attention without creating duplicate workflow-run projections.

Waiting approval and signal runs restore their durable wait plus handler attention. They are not force-resumed during bootstrap; after the handler or user resolves the approval or sends the signal, the handler resumes the same run through `smithers_run_workflow({ workflowId, input, runId })`.

**Confirmed code path:**

- `src/bun/session-catalog.ts`: schedules a one-shot durable workflow supervision restore on catalog startup, restores only sessions with nonterminal workflow runs or pending handler attention, dedupes startup/open-surface races per session, and still restores tracked sessions when surfaces or prompts are opened later.
- `src/bun/smithers-runtime/manager.ts`: `restoreSessionSupervision` refreshes the workflow registry, hydrates durable run ownership, flushes unapplied Smithers events from the durable cursor, reattaches active running runs through `runWorkflow(..., { runId, resume: true, force: true })`, and delivers pending handler attention.
- `src/bun/smithers-runtime/manager.ts`: `activeWorkflowPromiseByRunId` prevents duplicate live resume loops for the same Smithers run inside one manager.
- `src/bun/smithers-runtime/manager.ts`: terminal workflow replay remains idempotent after handler handoff and does not reopen a completed thread or enqueue duplicate attention.

**Verification:**

- `src/bun/smithers-runtime/manager.test.ts` now covers restart recovery for a running run that resumes the same Smithers `runId` to completion.
- The same test file covers approval wait restoration, duplicate restore idempotency, explicit same-run approval resume after restart, signal attention restoration, explicit same-run signal resume after restart, terminal no-resume behavior, and multi-batch event cursor replay.

**Documentation updates:** No PRD, feature inventory, or spec change is required; this implements the existing workflow-supervision and restart-recovery contract. `docs/progress.md` already tracked the durable reconnect/bootstrap capability as complete, so no roadmap item changed.

**Residual risk:** Smithers resume still depends on stable workflow source and Smithers resumability rules. If an entry is missing or Smithers rejects resume because the workflow changed incompatibly, the handler must repair or start an intentional replacement run rather than silently creating one during bootstrap.

### AUD-010 - Omitted Smithers `runId` can implicitly resume the wrong run

**Impact:** High workflow correctness issue.

**Disposition:** Fixed. `smithers_run_workflow` now has an explicit launch/resume split: supplied `runId` resumes exactly that owned run, while omitted `runId` requests a fresh launch and never silently selects a prior run.

**Precise issue:** The Smithers tool contract says a handler can resume a run by explicitly supplying `runId`. The previous manager logic could substitute a resumable same-thread, same-workflow run when `runId` was omitted.

Relevant code:

- `src/bun/smithers-tools.ts`: `smithers_run_workflow` describes the explicit launch/resume split and records failed launch attempts when the manager rejects an ambiguous call.
- `src/bun/smithers-runtime/manager.ts`: omitted `runId` no longer falls back to the newest same-thread same-workflow run.
- `src/bun/smithers-runtime/manager.ts`: omitted `runId` is rejected if the same handler thread already owns a nonterminal run with the same `workflowId`.
- `src/bun/smithers-runtime/manager.ts`: explicit `runId` validates svvy ownership, session, handler thread, workflow identity, nonterminal state, and Smithers runtime existence before resuming.

**Why this matters:** A handler call that appears to start a new workflow can instead resume stale state from an earlier run. This is especially dangerous after changed input, repair attempts, or unrelated workflow invocations with the same workflow id.

**Resolved behavior:**

- If `runId` is supplied, resume exactly that run after validating ownership, handler thread, workflow identity, nonterminal state, and Smithers runtime existence.
- If `runId` is omitted and this handler has no nonterminal run with the same `workflowId`, start a fresh run.
- If `runId` is omitted and this handler already owns a nonterminal run with the same `workflowId`, reject with a clear error that tells the handler to pass `runId`, cancel the old run, or wait for it to finish.
- If `runId` is omitted and this handler owns nonterminal runs with different `workflowId` values, allow the fresh launch.

**Verification:**

- `src/bun/smithers-runtime/manager.test.ts` covers omitted `runId` rejection when the same handler already owns a nonterminal run for that workflow.
- `src/bun/smithers-runtime/manager.test.ts` covers omitted `runId` allowing concurrent nonterminal runs with different workflow ids.
- Existing explicit same-run resume and restart reattach tests continue to pass with explicit run ids.
- Prompt/tool-description tests assert the handler-facing contract text.

**Documentation impact:** `docs/prd.md`, `docs/features.ts`, `docs/specs/workflow-supervision.spec.md`, handler generated agent context, and tool descriptions now state the explicit resume rule.

**Confidence:** High.

### AUD-011 - Cancelling inactive waiting Smithers runs can leave them stuck

**Impact:** High workflow lifecycle issue.

**Disposition:** Fixed. `smithers_runs_cancel` now mirrors Smithers server cancellation semantics instead of relying on a svvy-only cancel-request path for paused runs.

**Precise issue:** Cancelling a waiting run used to request cancellation and abort any in-memory monitor, but an inactive paused run may have no live engine loop to observe the cancellation request and terminalize the run.

Relevant code:

- `src/bun/smithers-tools.ts`: `runs.cancel` calls the workflow manager and reports whether cancellation was direct or requested.
- `src/bun/smithers-runtime/manager.ts`: running runs use Smithers' cancel-request/live-abort path.
- `src/bun/smithers-runtime/manager.ts`: `waiting-approval` runs are directly terminalized with `RunCancelled`.
- `src/bun/smithers-runtime/manager.ts`: `waiting-timer` runs follow Smithers server cleanup by cancelling waiting timer attempts/nodes, writing `TimerCancelled`, then writing `RunCancelled`.
- Smithers reference behavior: paused `waiting-approval` or `waiting-timer` states can be terminalized directly with `RunCancelled`; `running` states use cancellation observed by the engine loop; `waiting-event` is not direct-terminalized by Smithers server cancellation.

**Why this matters:** A waiting approval/timer/event can remain nonterminal after cancellation. That blocks handler progress, `thread_handoff`, and wait-state clearing.

**Resolved behavior:**

1. Inspect the current Smithers run status.
2. Directly terminalize `waiting-approval` and write `RunCancelled`.
3. Directly terminalize `waiting-timer` by cancelling waiting timer attempt/node rows, writing `TimerCancelled`, then writing `RunCancelled`.
4. Read the terminal Smithers state, project the product status into structured session records, clear `svvy` product wait or attention summaries, and deliver handler attention.
5. Keep live `running` runs on the request-and-abort path.
6. Reject `waiting-event` direct cancellation because Smithers server cancellation does not terminalize that state.

**Verification:**

- `bun test src/bun/smithers-runtime/manager.test.ts`
- `src/bun/smithers-runtime/manager.test.ts` covers cancelling live and restored/no-live-monitor paused approval runs into Smithers `cancelled` state, svvy `cancelled` projection, cleared waits, and handler attention.
- `src/bun/smithers-runtime/manager.test.ts` covers cancelling live and restored/no-live-monitor paused timer runs, including cancelled timer node/attempt rows plus `TimerCancelled` and `RunCancelled` events.
- `src/bun/smithers-runtime/manager.test.ts` covers `waiting-event` rejection according to current Smithers server behavior, with the run remaining in `waiting-event`.
- `src/bun/smithers-runtime/manager.test.ts` covers running cancellation through the live cancel-request path.

**Documentation impact:** `docs/specs/workflow-supervision.spec.md` now states the Smithers-aligned cancellation split, including the current `waiting-event` policy.

**Confidence:** High. Waiting approval/timer cancellation now follows Smithers server behavior, and the `waiting-event` policy is explicitly covered as non-direct-terminalized.

### AUD-012 - Project CI projection depends on in-memory terminal output

**Disposition:** Fixed for the restart/output-memory issue. Project CI projection now derives from durable Smithers output and durable `svvy` workflow ownership facts instead of process-local terminal output memory. The broader Smithers execution-state storage boundary is tracked above as a resolved design follow-up.

**Impact:** High durability issue for Project CI status.

**Precise issue:** Project CI records were created only when terminal workflow output was available in an in-memory map. If the app restarted after the Smithers run finished but before projection recorded the CI result, the terminal output was lost and the manager could not validate or record the CI result later.

Relevant code:

- `src/bun/smithers-runtime/manager.ts`: terminal output for CI projection was previously read from `terminalOutputByRunId`.
- `src/bun/smithers-runtime/manager.ts`: terminal output is read through `readDurableTerminalOutput(...)` from Smithers' durable `schema.output` table via Smithers' `loadOutputs(resolveSchema(...))` path instead of process memory.
- `src/bun/smithers-runtime/manager.ts`: a declared Project CI run is marked failed when durable terminal output is missing, with a troubleshooting summary instead of silently skipping projection.
- `src/bun/structured-session-state.ts`: persists CI run/check records after projection.

**Why this mattered:** A CI workflow could finish successfully in Smithers, but the svvy UI could permanently miss the result after a restart. CI state should be derived from durable workflow output, not process memory.

**Resolved design / best fix:**

Project CI is event-triggered reconciliation over durable Smithers result facts and durable `svvy` workflow ownership facts. Terminal events, monitor callbacks, and restart recovery may trigger derivation, but memory and copied `svvy` output fields are not authoritative.

1. Re-read terminal workflow output needed for CI projection from Smithers durable state during terminal projection.
2. Validate the durable output against `resultSchema` before recording CI.
3. Keep CI upserts idempotent so recovery can safely run after restart.
4. Run the same derivation after terminal events, monitor reconnect, and app restart recovery.
5. Record invalid or missing terminal output as a durable projection failure or workflow troubleshooting state instead of silently skipping CI projection.
6. Preserve current invalid-output rejection behavior: do not parse logs, node output, final prose, or command names to infer Project CI records.

**Verification required:**

- Launch declared Project CI workflow, finish it, recreate manager before CI projection, and assert CI run/check records are recovered from durable output.
- Invalid or lookalike outputs still do not create CI records.
- Re-running recovery does not duplicate checks.

**Verification:** `src/bun/smithers-runtime/manager.test.ts` includes Project CI schema-valid projection, invalid-output failure projection, idempotent repeated projection, restart recovery from durable Smithers output after Smithers finished before `svvy` projection, and missing durable terminal-output troubleshooting coverage.

**Documentation impact:** The Project CI and workflow supervision specs now state the durable-facts reconciliation contract. `docs/features.ts` summarizes the durable-facts design, and `docs/progress.md` records the landed restart-specific reconciliation and missing-result projection items.

**Confidence:** High.

### AUD-013 - Queued-message claiming is not atomic and dispatching rows are hidden

**Disposition:** Fixed. Queued surface-message dispatch now uses one atomic store claim, queue draining is centralized through one runner per `surfacePiSessionId`, and dispatching rows stay visible as locked/in-flight queue state until the prompt accepts the pending user message.

**Impact:** High conversation reliability issue.

**Precise issue:** Surface queued messages are drained through a read-then-mark sequence instead of a single transactional claim. The backend peeks the next pending surface message and then marks it dispatching. A concurrent drain can select the same row before either caller marks it. Separately, dispatching messages are excluded from the queue projection, so the UI can lose the visible "sending" row while a prompt is in flight.

Relevant code:

- `src/bun/session-catalog.ts`: prompt sends queue messages for busy surfaces and drains them later.
- `src/bun/structured-session-state.ts`: `peekPendingSurfaceMessage` and `markSurfaceMessageDispatching` are separate operations.
- `src/bun/structured-session-state.ts`: startup resets `steering`/`dispatching` queue states back to `queued`.
- `src/bun/structured-session-state.ts`: queue list/projection excludes dispatching rows.

**Why this matters:** A race can double-dispatch one queued user message. Even without the race, the user can lose visible feedback that a queued message has started dispatching.

**Best fix:**

1. Replace the peek-then-mark pair with one transactional `claimNextQueuedSurfaceMessage(surfacePiSessionId)` operation.
2. Use a conditional update from `queued` to `dispatching` ordered by queue position and return the claimed row.
3. Include `dispatching` rows in the renderer projection as locked/in-flight queue items.
4. Keep the existing startup reset from `dispatching` to `queued`, but record a recovery event or audit fact so the restart behavior is explainable.

**Implemented resolution:**

- `StructuredSessionStateStore.claimNextQueuedSurfaceMessage` transactionally selects the next `queued` row and changes it to `dispatching` before returning it.
- `WorkspaceSessionCatalog.wakeSurfaceQueue` deduplicates queue runners by `surfacePiSessionId`; visual panes, duplicate tabs, prompt-settle callbacks, and steering paths only wake the shared surface runner.
- `listQueuedSurfaceMessages` includes `dispatching` rows so renderer snapshots can show the in-flight row.
- Layout hydrate/re-sync now reuses an existing prompt-surface controller for repeated panes bound to the same `surfacePiSessionId` instead of opening/retaining the backend surface once per visual pane.

**Adjacent follow-ups found during the AUD-013 pass:**

- `smithers_run_workflow` launch and `thread_handoff` need a shared per-handler lifecycle claim so a fresh workflow launch cannot interleave with handoff completion.
- Workflow task-attempt message replacement should be transactional.
- Workflow task-attempt upsert should be backed by a durable uniqueness contract on Smithers run/node/iteration/attempt identity.

**Verification required:**

- Two concurrent claim attempts against one queued row return one claim and one empty result.
- Pre-accept failure restores the row to queued.
- Restart with a dispatching row restores it to queued.
- Renderer shows dispatching queue rows as locked/in-flight.

**Documentation impact:** Update queue behavior specs if dispatching/recovery states are documented.

**Confidence:** High for non-atomic claim and hidden dispatching state. Medium for observed double-dispatch frequency; the race is present, but was not reproduced under load.

### AUD-014 - Queue reorder persists continuously during drag hover

**Disposition:** Fixed. Drag-hover reordering now updates only local renderer preview state; the backend reorder RPC is called only for a final dropped order, and the durable store ignores no-op reorder submissions.

**Impact:** Medium performance and durability issue.

**Precise issue:** The queued-message strip persists reorder changes while drag movement is still in progress, not only when the user drops the item.

Relevant code:

- `src/mainview/QueuedMessagesStrip.svelte`: previously called `onReorder` during drag movement.
- `src/bun/session-catalog.ts`: exposes reorder RPC.
- `src/bun/structured-session-state.ts`: rewrites positions and emits queue events.

**Why this matters:** A single drag can write many intermediate orders to SQLite and emit many durable events. It also makes partially explored drag positions durable before the user commits the drop.

**Best fix:**

1. Keep drag-hover order changes local in the component.
2. Call the backend reorder RPC exactly once on pointer-up/drop.
3. Add backend no-op detection so identical order submissions do not write rows or emit events.
4. Update only changed rows instead of rewriting the full queue where practical.

**Implemented resolution:**

- `QueuedMessagesStrip` derives a drag preview order locally and commits `onReorder` only from pointer-up/drop when the final order differs from the current queue.
- `reorderSurfaceMessage` returns without writing or emitting a reorder event when the submitted order is identical.
- Durable reorder writes now skip rows whose persisted position already matches the final order.

**Verification required:**

- Component test: drag across several positions, release once, observe one reorder RPC.
- Store test: identical order produces no event/write.
- Restart test: only the final dropped order persists.

**Documentation impact:** None.

**Confidence:** High.

### AUD-015 - Handler `thread_handoff` reconciliation can be dropped when orchestrator is active

**Disposition:** Fixed. `thread_handoff` now records a durable handoff episode and closes the current objective span before scheduling a typed `handler_handoff` notification item in the orchestrator surface queue. The notification waits behind any active orchestrator turn or existing queued user messages and can be reconciled in order. Dismissing the notification cancels only the queue row; it does not roll back the durable handoff or return a tool error to the handler.

**Impact:** High orchestration correctness issue.

**Precise issue:** A successful handler `thread_handoff` records the episode and decision, then attempts to wake the orchestrator for reconciliation. If the orchestrator is already active, the wake path returns and no durable pending reconciliation is stored.

Relevant code:

- `src/bun/thread-handoff-tool.ts`: completes thread handoff, episode, and decision state.
- `src/bun/session-catalog.ts`: `resumeOrchestratorAfterHandlerHandoff` returns when the orchestrator is active.

**Why this matters:** The product contract says a successful handoff should immediately open an orchestrator reconciliation turn. If the orchestrator is busy at the wrong moment, the handler's result can remain durable but unprocessed until a user manually prompts the orchestrator.

**Resolved design:**

Use durable handoff recording plus the generic typed surface queue rather than a separate reconciliation queue.

1. Surface queue rows have a `kind`; all interactive surfaces accept `user_message`, and the orchestrator also accepts `handler_handoff`.
2. `thread_handoff` records the durable handoff episode, marks the active objective span completed, and creates a `handler_handoff` notification item with thread, command, title, summary, body, and episode-kind metadata.
3. If the orchestrator is active, the handoff remains queued behind existing orchestrator work and visible with distinct handoff UI.
4. Queue delivery submits the handoff notification as orchestrator input so the orchestrator reconciles already-recorded durable state.
5. Notification dismissal cancels the queue row without changing the completed handler command or durable handoff episode.

App restart during the pending notification remains part of the broader workspace queue recovery problem tracked separately.

**Implemented resolution:**

- `surface_message_queue` now carries a queue item `kind` and optional payload; `handler_handoff` items reuse the same ordering, claim, steering, and projection path as queued user messages.
- `thread_handoff` delegates durable handoff recording and notification enqueueing to the catalog, then returns once the handoff is recorded.
- The old direct `resumeOrchestratorAfterHandlerHandoff` path was removed, so normal handler turns and initial auto-start handler turns use the same handoff queue semantics.
- The queued-message UI renders handler handoffs with distinct labeling and notification controls instead of editable user-message controls.

**Verification required:**

- Handler hands off while orchestrator is idle: the handoff queue item is accepted as the next orchestrator input.
- Handler hands off while orchestrator is active: no concurrent turn starts, the notification remains visible in the orchestrator queue, and dismissal does not alter the durable handoff episode.
- Queued handoff rows can be ordered with queued user messages and rendered distinctly.
- Restart with a pending handoff notification is covered by workspace-runtime queue recovery.

**Documentation impact:** Update thread/handoff specs to describe pending reconciliation delivery if a spec exists.

**Confidence:** High.

### AUD-016 - Initial auto-start handler handoff does not wake the orchestrator

**Disposition:** Fixed by the AUD-015 durable handoff notification design. `thread_handoff` owns durable handoff recording and notification enqueueing directly, so the handler prompt entrypoint no longer matters; initial auto-start handler turns and normal handler follow-up turns both schedule the same queued orchestrator notification path.

**Impact:** High orchestration correctness issue.

**Precise issue:** Handler threads can auto-start with an initial prompt. If that initial handler turn calls `thread_handoff`, the regular post-run wake path is not invoked, so the orchestrator may never get the reconciliation turn.

Relevant code:

- `src/bun/session-catalog.ts`: `createHandlerThread` schedules `startInitialHandlerThreadPrompt`.
- `src/bun/session-catalog.ts`: `startInitialHandlerThreadPrompt` runs the handler prompt but does not call the orchestrator handoff resume path after completion.
- Existing tests cover a normal handler reply path but not initial auto-start handoff reconciliation.

**Why this matters:** Short delegated tasks are likely to complete during their first turn. Those are exactly the cases where a missing wake leaves the orchestrator idle with completed handler work.

**Best fix:**

Use the same durable reconciliation mechanism from AUD-015 for all handler prompt completions.

Minimal safe change:

1. Ensure `startInitialHandlerThreadPrompt` runs the same finalizer used by normal handler turns.
2. That finalizer should inspect newly completed handoffs and enqueue/deliver reconciliation.

Better change:

- Make `thread_handoff` itself responsible for durable reconciliation delivery, independent of which handler-turn entrypoint produced it.

**Verification required:**

- Auto-start handler immediately calls `thread_handoff`; orchestrator receives one synthetic reconciliation turn.
- Same scenario while orchestrator is busy; reconciliation is pending and delivered after settle.
- Restart after auto-start handoff but before delivery; reconciliation still delivers once.

**Documentation impact:** None if implementing the existing handoff contract.

**Confidence:** High.

### AUD-017 - Prompt freshness is detected but not enforceably applied

**Disposition:** Fixed. Generated agent context updates are explicit surface work. The sticky stale-generated-context warning applies immediately when the surface is idle and has no queued work; otherwise it creates an `agent_context_refresh` queue item labelled `Update agent context`, the row is visible and cancellable, and the shared surface queue runner applies the fresh generated agent context binding before later user messages or handler handoffs run.

**Impact:** High prompt correctness issue.

**Precise issue:** Surfaces could detect stale prompt bindings and show a warning, but there was no complete path to apply an updated prompt binding before the next user turn. Existing managed-session recreation checked actor/provider/model/recreate flags, but not prompt drift. The UI banner was informational and lacked working `Update system prompt` behavior.

Relevant code:

- `src/bun/session-catalog.ts`: computes prompt stale state.
- `src/renderer/components/DockviewPanelHost.svelte`: shows a stale prompt banner.
- `src/bun/session-catalog.ts`: recomputes resolved prompt during dispatch preparation.
- `src/bun/session-catalog.ts`: managed session recreation does not use prompt drift as a recreation/update trigger.
- No complete update API was found for applying the fresh binding to an existing surface.

**Why this matters:** Users can see that a session generated agent context is stale, choose or expect freshness, and still send the next turn with the old binding. This breaks runtime standards, generated tool/schema blocks, loaded extension guidance, and actor instruction updates.

**Implemented resolution:**

1. Added `agent_context_refresh` as a typed surface queue item alongside `user_message` and `handler_handoff`.
2. Added a backend queue action used by the stale-generated-context warning.
3. The queue runner claims `agent_context_refresh`, rebuilds generated agent context from backend source of truth, refreshes or rebinds the managed pi session behind the same product surface, marks the item delivered, and continues draining later queued work.
4. Normal sends respect existing queued surface work, so a direct send cannot jump ahead of a queued agent context refresh.
5. Agent and extension changes emit open-surface snapshots so stale status updates without reopening the pane.
6. The renderer shows a sticky stale-generated-context strip with `Update agent context`, switches to `Cancel update` while the refresh item is queued, and renders the queued context update as a visible cancellable `Update agent context` row.

**Verification required:**

- Existing surface with stale prompt keeps old prompt when user chooses keep.
- User chooses update; next prompt sent to pi includes the new resolved prompt.
- Runtime standards drift triggers stale status.
- Queued message drain, handler handoff resume, workflow attention resume, and normal prompt send all honor pending prompt updates.
- Renderer actions exist and update state.

**Documentation impact:** Update prompt-binding and surface lifecycle specs. If the user-visible feature shape changes, update `docs/features.ts`.

**Confidence:** High.

### AUD-018 - New-session and mode-switch prompt composition can double-wrap or bypass generated prompts

**Disposition:** Fixed. Session defaults now carry raw agent-profile settings instead of a prebuilt system prompt, and new-session creation, session mode switching, surface opening, and prompt dispatch no longer accept caller-provided resolved prompt text as a composition input. The catalog composes the final orchestrator generated agent context exactly once from Agents/Extensions state plus the selected raw agent-profile settings.

**Impact:** High agent behavior issue.

**Precise issue:** Session defaults can already contain a composed system prompt, then the catalog composes again using those defaults. Non-default session-agent text can be appended under `## Session Agent` even when that text is already a full composed prompt. Mode switching has inconsistent call paths that can pass raw prompt text directly.

Relevant code:

- `src/bun/index.ts`: session defaults are built with a composed prompt.
- `src/bun/session-catalog.ts`: create-session path calls prompt composition again with `defaults.systemPrompt`.
- `src/bun/session-catalog.ts`: non-default suffix handling appends session-agent content under `## Session Agent`.
- `src/bun/session-catalog.ts`: mode switching can pass defaults prompt text directly into managed-surface recreation.

**Why this matters:** Agents can receive duplicated generated sections, duplicated tool declarations, duplicated web context, or a full prompt nested as a suffix. Conversely, raw mode input can bypass expected generated prompt sections. Both cases make behavior hard to reason about and can alter tool use.

**Best fix:**

1. Separate raw session-agent settings from resolved system prompts at the type level.
2. `SessionDefaults` should carry `sessionAgentKey` and raw `SessionAgentSettings`, not a pre-composed system prompt.
3. Centralize final prompt composition in the session catalog exactly once.
4. Use distinct names/types such as `sessionAgentSuffix` and `resolvedSystemPrompt` so a full prompt cannot accidentally be treated as a suffix.
5. Make mode switching route through the same composition function as new-session creation.

**Verification required:**

- New session prompt contains each generated section once.
- Custom "dumb" or suffix-style session agent appears once under the intended heading.
- No nested full prompt appears under `## Session Agent`.
- Mode switching preserves generated sections and applies only the intended changed agent settings.

**Documentation impact:** Update prompt-composition specs if they currently describe the old flow.

**Confidence:** High for double-wrap risk. Medium for raw mode-switch bypass until all mode-switch callers are exhaustively tested.

### AUD-019 - Ambient pi extension tools can leak into orchestrator and handler sessions

**Decision:** Adopted for implementation as a provider-neutral Ambient Agent Resources feature. The product should not simply delete all native host resources; behavior-changing ambient resources are disabled by default and can be explicitly enabled through settings by host, workspace, actor class, category, and source. See `docs/specs/ambient-agent-resources-baseline.spec.md`.

**Impact:** High capability-isolation and determinism issue.

**Precise issue:** Workflow task agents disable pi extension discovery, but orchestrator and handler resource loaders do not pass `noExtensions: true`. The custom tool list suppresses built-ins, but ambient workspace/user pi extensions can still be discovered by pi. The broader issue is not limited to extension tools: pi and other coding-agent hosts can discover skills, prompt templates, commands, hooks, themes, packages, provider adapters, credentials, and execution-policy settings that can change the actor's effective prompt, callable surface, command behavior, UI behavior, provider behavior, auth path, or runtime policy.

Relevant code:

- `src/bun/session-catalog.ts`: orchestrator and handler sessions use `DefaultResourceLoader` with prompt overrides and custom tools, but without `noExtensions`, `noSkills`, `noPromptTemplates`, or `noThemes`.
- `src/bun/workflow-task-agent.ts`: task agents already pass `noExtensions: true` and have regression coverage, but still need the broader default-off policy for skills, prompt templates, themes, and equivalent future host resources.
- pi reference behavior: default resource loading can discover `.pi/extensions`, `.pi/skills`, `.agents/skills`, `.pi/prompts`, `.pi/themes`, package resources, global agent-dir resources, and settings-provided resource paths.

**Why this matters:** The actor contract says svvy actors receive the generated capability set and generated agent context selected by svvy, not arbitrary ambient host resources. Ambient resource leakage weakens capability isolation and makes behavior dependent on local user/workspace/global host files.

**Best fix:**

1. Add provider-neutral Ambient Agent Resources settings with all behavior-changing ambient resource categories disabled by default.
2. Preserve pi-discovered `AGENTS.md` and `CLAUDE.md` runtime standards as visible `external_instruction` extension records, with source paths and hashes.
3. Continue ignoring pi `SYSTEM.md` and `APPEND_SYSTEM.md` prompt replacement/append files in favor of svvy's generated agent context.
4. For pi, pass `noExtensions`, `noSkills`, `noPromptTemplates`, and `noThemes` by default for orchestrator, handler-thread, and workflow task-agent loaders, then opt in only the enabled category/source/actor set through explicit loader paths or filters.
5. Keep generated actor-specific declarations as the only way callable ambient resources become visible to an actor.

**Verification required:**

- Create fixtures for `.pi/extensions`, `.pi/skills`, `.agents/skills`, `.pi/prompts`, `.pi/themes`, package resources, and settings-provided resource paths.
- Create/open orchestrator, handler, and workflow task-agent sessions with default settings; assert ambient resources do not affect active tools, generated prompt previews, command routing, UI resources, provider/auth behavior, or execution policy.
- Enable a specific resource category/source/actor and assert it appears only in the selected actor scope.
- Assert active tool names exactly match the generated/allowed svvy tool set plus explicitly enabled ambient callable resources.

**Documentation impact:** Added `docs/specs/ambient-agent-resources-baseline.spec.md`; update PRD, feature inventory, and progress tracker with the adopted settings-gated design.

**Confidence:** High from source and pi behavior. Dynamic reproduction was not run in the audit.

### AUD-020 - Workflow task-agent config, generated declarations, saved settings, and runtime behavior diverged

**Disposition:** Fixed, with the cx portion superseded by `docs/specs/extension/cx.extension.spec.md`.
`WorkflowTaskAgentConfig` now uses `reasoningEffort`, settings render workflow agents assignable to
that contract, runtime task-agent registration filters the ordered task-tool registry by
`config.toolSurface`, and task-agent projection binds by exact Smithers `(runId, nodeId, iteration,
attempt)` identity. The earlier native `cx_*` normalization finding is obsolete: cx v1 is now a
prompt-only direct CLI extension, not a generated or native task-tool family.

**Impact:** High workflow authoring correctness issue when present.

Resolved drift:

- Generated `WorkflowTaskAgentConfig` uses `reasoningEffort`.
- Rendered workflow-agent settings use `reasoningEffort` and are assignable to `WorkflowTaskAgentConfig`.
- Generated/default contracts exclude native `cx_*`; when the cx extension is loaded, it contributes
  prompt-only official CLI guidance for use through `exec_command`.
- Runtime task-agent creation registers exactly the ordered registry tools requested by `config.toolSurface`.
- Task-agent projection no longer discovers Smithers attempts by resume handle or recency.

Relevant code:

- `src/bun/smithers-runtime/workflow-authoring-contract.ts`: generated config declaration and ordered task-tool registry.
- `src/bun/smithers-runtime/workflow-task-agent.ts`: runtime task-agent tool registration.
- `src/bun/structured-session-state.ts`: durable workflow task-attempt rows are uniquely keyed by Smithers run, node, iteration, and attempt.
- `src/bun/session-agent-settings.ts`: rendered workflow-agent components/settings.
- `src/bun/smithers-runtime/workflow-task-agent-config.ts`: default workflow task-agent config.

**Why this matters:** Authors and generated code must be able to trust that a workflow task agent receives the config shape and callable surface it declares.

**Verification covered:**

- Rendered workflow-agent settings are assignable to the generated `WorkflowTaskAgentConfig`.
- cx prompt-only CLI guidance appears in generated actor context without adding native `cx_*` tools.
- A narrow `toolSurface` produces exactly that task-agent tool set.
- The default task-agent surface includes the documented task-local direct tools and `execute_typescript`.
- Duplicate or repeated pi resume handles cannot bind projection to the wrong Smithers attempt.

**Confidence:** High.

### AUD-021 - Task-agent prompts and extension-loading context binding are not durable enough

**Impact:** High prompt and provenance correctness issue.

**Precise issue:** Custom workflow task-agent prompts can replace the svvy workflow-task base prompt instead of layering on top of it. Task attempts store prompt text/model/resume metadata but not enough binding metadata to prove which generated agent context fingerprint, external instruction fingerprint, or resolved prompt artifact was used. Handler loaded-extension state is durable, but active pi sessions are not guaranteed to be recreated or updated so the newly loaded extension guidance is present on the next turn.

Relevant code:

- `src/bun/workflow-task-agent.ts`: custom config system prompt can replace the generated base task prompt.
- `src/bun/structured-session-state.ts`: task attempt prompt metadata lacks fingerprint/source binding fields.
- `src/bun/load-extension-tool.ts`: records loaded extension changes.
- `src/bun/session-catalog.ts`: rebuilds resolved prompts, but retained managed sessions are recreated for actor/provider/model/recreate flags, not loaded extension changes.

**Why this matters:** Workflow task agents can lose svvy's task contract and API instructions. Task-attempt records are not audit-grade enough to reconstruct the exact generated agent context provenance. Handler-loaded extension guidance, including Project CI guidance, may be recorded in state but absent from the live pi prompt used for the next turn.

**Best fix:**

1. Treat workflow task-agent custom prompts as overlays appended to the svvy workflow-task base prompt unless an explicit product decision says full replacement is allowed.
2. Persist generated agent context binding metadata on task attempts: loaded extension ids, external instruction fingerprints, generated agent context fingerprint, resolved prompt artifact id, and any generated artifact/schema ids.
3. When `load_extension` changes loaded extension state, mark the managed handler surface as needing generated agent context refresh before the next turn.
4. Recreate or update the live pi session before dispatching the next handler prompt when loaded extensions changed.
5. Avoid recency-based task-attempt lookup where exact run/node/iteration/attempt identity is available.

**Verification required:**

- Custom task prompt still includes the base workflow-task instructions and API contract.
- Task attempts persist prompt binding metadata at creation.
- `load_extension({ extensionId: "project-ci" })` causes the next handler prompt sent to pi to include Project CI extension guidance.
- Duplicate or repeated task-agent resume handles do not bind to the wrong attempt.

**Documentation impact:** Update workflow task-agent prompt semantics and task-attempt provenance specs.

**Disposition:** Fixed. Workflow task-agent custom prompts now append under a workflow-task override section while preserving the minimal svvy workflow-task base prompt and generated callable contract. The base prompt defines task scope and task-root locality without teaching unavailable handler, orchestrator, or Smithers controls. Task-local command bootstrap writes `meta.agentContextBinding` onto the exact workflow-task-attempt projection keyed by Smithers `(runId, nodeId, iteration, attempt)`, including loaded extension ids, generated agent context fingerprint, external instruction fingerprints, resolved prompt artifact id, and binding timestamp. Handler-side `load_extension` now marks the retained managed handler surface for generated agent context refresh before its next turn, so newly loaded extension guidance reaches pi through the system-prompt channel instead of only being stored durably.

**Verified by:** `bun test src/bun/load-extension-tool.test.ts src/bun/smithers-runtime/workflow-task-agent.test.ts`.

**Confidence:** High. The fixed path is covered by focused request-context and workflow task-agent tests.

### AUD-022 - Dockview transcript panels omit semantic blocks and action callbacks

**Impact:** Medium-high UI functionality issue.

**Precise issue:** `ChatTranscript` supports semantic transcript blocks and callbacks, but the Dockview panel host mounts it with only basic props. The static Dockview chat path therefore loses wait/failure/command/handoff/thread/workflow cards and their actions.

Relevant code:

- `src/mainview/ChatTranscript.svelte`: supports `semanticBlocks` and action callbacks.
- `src/mainview/transcript-projection.ts`: builds semantic blocks.
- `src/mainview/DockviewPanelHost.svelte`: mounted `ChatTranscript` without those semantic blocks/callbacks and passed an empty mention path set.

**Why this matters:** The Dockview UI is supposed to be the main semantic workspace. If it renders only raw transcript text, users lose structured workflow status, command cards, handoff cards, failure actions, and navigation affordances.

**Best fix:**

1. Move semantic block construction and callback wiring into the Dockview chat panel path.
2. Pass `semanticBlocks`, real workspace mention paths, and action callbacks into `ChatTranscript`.
3. Ensure callbacks open static inspector panes using the target surface model rather than global focus state.

**Disposition:** Fixed. Dockview chat panels now build transcript semantic blocks from the active session summary, command rollups, live surface error state, and loaded handler-thread summaries. The host passes the real workspace mention index into `ChatTranscript` and wires transcript actions to exact Dockview/runtime routes: commands open command inspector panes, handler-thread cards open their owning thread surface by exact `threadId`, workflow cards open workflow inspectors, workflow task-agent cards open workflow-task-attempt inspectors, wait replies target the owning handler thread when present, and failure retry sends a normal follow-up to the active surface. Filename-only transcript artifacts are routed through workspace-path opening because that callback does not carry a durable artifact id.

**Verified by:**

- `bun test src/mainview/default-workspace-shell.test.ts`.
- `bun run check`.

**Documentation impact:** None unless the semantic transcript feature inventory needs wording updates.

**Confidence:** High.

### AUD-023 - Artifact/static inspector state still depends on global focus

**Impact:** Medium-high multi-pane UX correctness issue.

**Precise issue:** The codebase has a newer Dockview surface target model for static artifact and inspector panes, but legacy focus-global artifact/inspector state remains. Some artifact and inspector openings depend on `currentSession`, `currentPane`, or the focused panel rather than a durable pane target.

Relevant code:

- `src/mainview/ChatWorkspace.svelte`: maintained focus-global artifact state and global modal inspectors.
- `src/mainview/DockviewPanelHost.svelte`: supports static artifact/inspector targets.
- `src/shared/workspace-contract.ts`: defines `WorkspacePaneSurfaceTarget`-style static targets.

**Why this matters:** Multiple panes cannot independently inspect different artifacts or related records if the preview model is partly global. Opening an artifact from one pane can affect another pane or the global drawer. It also makes deep links and restored static panes less reliable.

**Best fix:**

1. Retire the focus-global artifact drawer/modal inspector paths for Dockview-owned surfaces.
2. Open artifacts, commands, threads, workflow runs, task attempts, and CI checks as explicit `WorkspacePaneSurfaceTarget` records through `runtime.openSurface`.
3. Store local preview state in pane-local state, not global workspace focus state.
4. Keep any global drawer only as a deliberate app-global shortcut with clear source routing.

**Disposition:** Fixed. The workspace shell no longer keeps a focus-global artifact drawer or modal command/thread/task-attempt inspectors for Dockview-owned routes. Artifact, command, workflow, workflow-task-attempt, Project CI, and handler-thread openings now route through explicit `runtime.openSurface` targets owned by the pane layout. The old pane-local `inspectorSelection` bridge was removed; static inspector panes restore from their explicit target records instead of global focus.

**Verified by:**

- `bun run typecheck`.
- `bun test src/mainview/default-workspace-shell.test.ts`.
- `bun test src/mainview/default-workspace-shell.test.ts src/mainview/artifacts.test.ts src/mainview/related-inspector-pane.test.ts`.
- `bun run check`.

**Documentation impact:** The feature inventory, pane-layout spec, workspace-navigation projection spec, and PRD now describe explicit static inspector pane targets and sandboxed artifact inspector previews.

**Confidence:** High. The global artifact/modal inspector paths and pane-local inspector-selection bridge are removed from the workspace shell and pane-layout runtime.

### AUD-024 - Restart recovery lacks one durable scheduler for active prompts, initial starts, queues, and workflow monitors

**Disposition:** Partially implemented. The adopted design is captured in `docs/specs/workspace-runtime-recovery.spec.md`, and the runtime now has a workspace-scoped durable scheduler table plus coordinator for Smithers bootstrap, surface-turn settlement, queue drain, handler initial starts, handoff notification recovery, title jobs, workflow attention, and Project CI projection. Remaining audit follow-up is full recovery app-log projection and broader restart-boundary integration coverage.

**Impact:** Medium-high cross-cutting reliability issue.

**Precise issue:** Several restart-sensitive flows have local repair logic, but there is no single durable scheduler that owns recovery of in-flight or pending work across prompts, queues, initial handler starts, handoff reconciliation, and workflow supervision.

Concrete confirmed pieces:

- AUD-009: nonterminal Smithers runs are hydrated but not reattached/resumed.
- AUD-013: dispatching queue rows are restored to queued on startup, but claiming is non-atomic and dispatching rows are hidden.
- AUD-015: handoff reconciliation notification can be dropped when the orchestrator is busy.
- AUD-016: initial auto-start handler handoff lacks the normal wake path.

**Why this matters:** Each individual bug has a local fix, but the shared product requirement is stronger: pending work should survive process boundaries and resume exactly once. Without one recovery owner, fixes can remain fragmented and new flows can repeat the same pattern.

**Best fix:**

Create a workspace-runtime recovery coordinator that runs at startup and after runtime rehydration.

Responsibilities:

1. Reattach or settle nonterminal workflow runs.
2. Restore dispatching/steering queued messages to queued and expose their status.
3. Drain durable handoff notification and reconciliation records.
4. Resume pending initial handler starts exactly once.
5. Emit explicit recovery events/facts so the UI and logs can explain what happened.
6. Use transactional claims for every resumed work item.

**Verification required:**

- App restart with one pending item from each category; coordinator resumes or restores each exactly once.
- Concurrent startup/open-surface paths do not double-run recovery.
- Recovery order is deterministic where dependencies exist, especially workflow attention before handler/orchestrator prompt resume.

**Documentation impact:** `docs/specs/workspace-runtime-recovery.spec.md` defines the adopted workspace-runtime recovery coordinator design. Runtime behavior now has the durable scheduler/coordinator foundation, with remaining verification work tracked in `docs/progress.md`.

**Confidence:** Medium-high. This section consolidates confirmed restart gaps rather than introducing a separate newly probed call site.

### AUD-025 - Streaming emits full snapshots and reparses full Markdown on every delta

**Disposition:** Fixed. Live assistant packets now emit compact ordered `stream.patch` payloads keyed by `surfacePiSessionId`, and the renderer applies those patches to the active stream message without replacing the full surface snapshot. Full snapshots remain for open/rebaseline/recovery/settled states. Markdown rendering now reuses parsed token/code-block results for stable message content and avoids expensive highlighting for an unfinished trailing stream fence.

**Impact:** Medium-high scalability and responsiveness issue.

**Precise issue:** Backend stream events emit full surface snapshots on every content delta. The renderer receives those snapshots, resets/replaces large message structures, and sends the accumulated assistant content back through full Markdown parsing/highlighting paths each time.

Relevant code:

- `src/bun/session-catalog.ts`: stream events update `activeStreamMessage` and call surface sync for each delta.
- `src/bun/session-catalog.ts`: surface sync builds full `ConversationSurfaceSnapshot` payloads.
- `src/renderer/runtime/chat-runtime.ts`: sync handling resets/replaces agent messages and stream state.
- `src/renderer/components/ChatTranscript.svelte` and `src/renderer/components/AssistantMarkdown.svelte`: render accumulated content through Markdown parsing/code-block extraction.

**Why this matters:** Cost grows with transcript size and response length. Every token or chunk can carry full conversation state across the bridge and trigger repeated parse/highlight work for content that did not change.

**Best fix:**

1. Introduce a stream patch protocol with monotonic stream sequence numbers.
2. Use full snapshots only for open/rebaseline/settled states.
3. Emit compact append/replace/finalize patches for live stream deltas.
4. Apply stream patches in the renderer without resetting the whole agent/session object.
5. Cache Markdown parse results by stable block/message id.
6. During streaming, parse only changed segments where possible and defer expensive syntax highlighting/Mermaid work until fences are complete or the stream is final.

**Verification required:**

- Backend test: stream deltas emit compact patches instead of full message snapshots.
- Renderer test: applying a patch mutates only the active stream message.
- Markdown test: unchanged blocks are not reparsed across stream deltas.
- Manual long-response profile showing lower bridge payload size and render work.

**Documentation impact:** `docs/prd.md`, `docs/features.ts`, and `docs/specs/multi-session-support.spec.md` now describe stream patches as the live-packet path and full snapshots as the baseline/recovery/settled path.

**Confidence:** High. Focused backend and renderer tests cover patch emission/application, and full preflight is required before commit.

### AUD-026 - Workflow inspector polls and rebuilds full snapshots instead of applying deltas

**Impact:** Medium-high performance issue for large workflow runs.

**Precise issue:** The workflow inspector uses a short polling loop and replaces the whole inspector snapshot. Backend streaming calls still rebuild the full inspector from Smithers DevTools state, frames, events, details, and projections. Renderer expansion/search/selection changes can trigger more full reloads.

Relevant code:

- `src/renderer/components/WorkflowInspectorPane.svelte`: schedules polling and replaces the inspector state.
- `src/bun/session-catalog.ts`: inspector stream calls into the workflow manager and returns full inspector snapshots.
- `src/bun/workflow-supervision/manager.ts`: fetches full DevTools state and full inspector data.
- `src/bun/workflow-inspector.ts`: rebuilds tree/projection data by scanning full snapshots.

**Why this matters:** A tree-first inspector should scale with changed workflow events. Full rebuilds and polling amplify SQLite/Smithers reads, bridge payloads, and renderer work as run history grows.

**Best fix:**

1. Build an inspector live-tree store.
2. Load one initial baseline.
3. Apply Smithers event deltas to the tree and detail indexes.
4. Rebaseline only on snapshot gaps, time-travel changes, or explicit refresh.
5. Keep selection, expansion, and search local unless focused detail data is missing.
6. Pre-index nodes, commands, task attempts, artifacts, CI checks, and event ids for lookup.

**Verification required:**

- Projection tests for add/remove/update/replace deltas.
- Backend stream test proving normal event updates do not call full `getDevToolsSnapshot` every poll.
- Renderer test proving local expansion/search does not refetch the full inspector.
- Manual large-run inspector profile.

**Documentation impact:** Update the workflow-inspector spec to define baseline-plus-delta wire behavior.

**Confidence:** High.

### AUD-027 - Structured selectors and read APIs materialize broad snapshots with limited indexes

**Impact:** Medium-high scalability issue.

**Precise issue:** Hot read paths materialize broad `StructuredSessionSnapshot` objects and then filter/sort in memory. The SQLite schema has relatively few indexes for the number of session/thread/workflow/task/surface/artifact lookup patterns used by sidebars, inspectors, runtime tools, and selectors.

Relevant code:

- `src/bun/structured-session-state.ts`: broad `StructuredSessionSnapshot`, `getSessionState`, and `listSessionStates` materialize many arrays.
- `src/bun/session-catalog.ts`: list/read flows load full snapshots and projections.
- `src/bun/structured-session-selectors.ts`: repeatedly filters and sorts arrays for derived views.
- Existing explicit indexing is limited relative to access patterns.

**Why this matters:** Small workspaces can tolerate snapshot-first reads. Large transcripts, many workflow runs, artifacts, commands, and panes will make sidebar refreshes, inspector opens, attention queries, and runtime tool calls slower and more memory-heavy.

**Best fix:**

1. Add narrow store-level read models for hot views: session list, attention list, queue list, thread list, workflow run list, task-attempt list, artifact list, and command summary list.
2. Keep full `getSessionState` for debug/export paths, not routine UI refresh.
3. Add indexes for session id, thread id, workflow id, task attempt id, surface id, Smithers run id, parent command id, status, updated timestamp, artifact ownership, and queue order.
4. Build selector maps once per snapshot where full snapshots are still needed.
5. Add scale tests with thousands of rows to lock in query count and runtime.

**Verification required:**

- Migration tests for new indexes.
- Equivalence tests comparing new read models to old selector output.
- Scale tests for `listSessions`, inspector open, attention list, and artifact list.
- Ensure snapshots remain available for export/debug.

**Documentation impact:** Update structured-state docs with the read-model/index expectations.

**Confidence:** High.

### AUD-028 - Native app-menu command actions are ignored by the renderer

**Impact:** Medium user-facing command issue.

**Precise issue:** Native menu actions are emitted as an action string by the runtime subscription, but the renderer callback destructures the callback argument as an object. That makes `action` undefined and app-menu commands no-op.

Relevant code:

- `src/shared/shortcut-registry.ts`: shared action registry.
- `src/bun/index.ts`: native app menu sends `{ action }` over the bridge.
- `src/renderer/runtime/chat-runtime.ts`: unwraps the RPC and invokes listeners with the action string.
- `src/renderer/components/ChatWorkspace.svelte`: registers `({ action }) => handleAppMenuAction(action)`.

**Why this matters:** Renderer hotkeys and sidebar actions can still work, but native menu clicks and menu accelerators do not dispatch the intended command from this path.

**Best fix:**

Change the renderer subscription callback to accept the string directly:

```ts
runtime.subscribeAppMenuAction((action) => {
  handleAppMenuAction(action);
});
```

Then keep the bridge/runtime callback type aligned so this mismatch cannot recur.

**Verification required:**

- Unit or renderer test emitting a native menu action and asserting `handleAppMenuAction` receives the expected action.
- Optional e2e/native-menu harness test for a real menu accelerator.

**Documentation impact:** None.

**Confidence:** High.

### AUD-029 - Command palette coverage is incomplete and not fully target-driven

**Impact:** Medium workspace navigation issue.

**Precise issue:** The command palette is partially hard-coded and misses first-class surfaces/actions that exist elsewhere in the app. Handler and task-agent results are limited by focused-session state, and several target types do not use the static pane target model.

Relevant code:

- `src/renderer/command-palette.ts`: registry includes session actions, settings, workflows, panes, and some Project CI prompt actions.
- `src/renderer/command-palette.ts`: handler threads come only from focused session input; task agents use a session/modal route.
- `src/renderer/components/ChatWorkspace.svelte`: already has routes for Logs, Workflows, Context, workflow/task views.
- `src/bun/workspace-contract.ts`: defines static targets for task attempts and Project CI checks.

Confirmed gaps:

- No direct Open Logs command.
- No direct Open Context command.
- Workflow inspector and Project CI inspection actions are incomplete.
- Handler/thread results are limited to focused orchestrator context.
- Task-agent command route is unsettled relative to static target panes.

**Why this matters:** The palette should be the high-speed navigation surface for sessions, logs, workflows, context, task agents, Project CI, and panes. Partial coverage forces users back into sidebar-specific flows and makes restored/static panes less discoverable.

**Best fix:**

1. Add direct Logs and Context commands.
2. Use `WorkspacePaneSurfaceTarget` as the command result target for static surfaces.
3. Build handler, thread, workflow, and task results from durable navigation/read-model rows instead of only focused-session props.
4. Add latest/active Project CI actions and direct check inspection actions.
5. Settle task-agent routing through static pane targets where applicable.

**Verification required:**

- Registry tests for Logs, Context, Workflows, Workflow Inspector, Project CI latest/active/check, handlers, threads, and task attempts.
- E2E/palette tests that searching and selecting each command opens the expected surface.
- Multi-pane tests proving commands target the intended pane/context.

**Documentation impact:** Update command-palette/navigation feature docs if command coverage is described exhaustively.

**Confidence:** High.

### AUD-030 - Destructive session delete remains in backend/API despite archive-first product contract

**Impact:** Medium-high data-loss risk.

**Precise issue:** The product contract describes archive/unarchive as the user-facing non-destructive lifecycle. The UI appears to use Archive/Unarchive, but backend/runtime contracts still expose destructive `deleteSession` paths and stale tests assert delete dialogs/events.

Relevant code:

- `src/bun/workspace-contract.ts`: exposes `deleteSession`.
- `src/bun/session-catalog.ts`: delete unlinks orchestrator and handler pi files.
- `src/bun/index.ts`: bridge event path emits deletion.
- `src/renderer/runtime/chat-runtime.ts`: runtime delete method.
- `src/renderer/components/SessionSidebar.svelte` and `SessionListItem.svelte`: current UI labels are archive/unarchive.
- E2E/bridge tests still cover delete behavior.

**Why this matters:** Any caller that reaches the delete RPC can cause transcript/session loss, even though the product direction is reversible archiving. Tests that preserve destructive behavior make future cleanup harder.

**Best fix:**

1. Remove public `deleteSession` RPC/runtime methods from the normal product API.
2. Convert stale tests to archive/unarchive.
3. Keep archive state durable and reversible.
4. If permanent purge is required later, introduce a separate explicit purge contract with confirmation, scope, cleanup rules, and documentation.

**Verification required:**

- Archive hides the session but preserves files/facts/state.
- Unarchive restores the session.
- No normal renderer path calls destructive delete.
- Old delete tests are removed or rewritten.

**Documentation impact:** Remove stale delete language from specs, including app-log/spec references if present. No PRD/features change is needed if archive remains the intended product behavior.

**Confidence:** High.

### AUD-031 - E2E/proof tests use retries, broad waits, force clicks, and live-provider gates

**Impact:** Medium reliability issue that can hide product bugs or fail in normal local runs.

**Precise issue:** The e2e harness and workflow proof tests include retry loops, broad polling waits, force clicks, brittle selectors, and a real provider-key requirement in default test paths. Repo instructions explicitly say not to hack around failing e2e tests with retries, broad waits, selector churn, best-effort fallbacks, or test-only behavior.

Relevant code:

- `e2e/harness.ts`: launch metadata retries and long workspace chrome polling.
- `e2e/workflow-supervision.test.ts`: live `ZAI_API_KEY` gating and force/retry interactions.
- `e2e/workflow-supervision-proof.test.ts`: long custom polling/stub paths.
- Unit/integration coverage exists for parts of workflow restart behavior, but a full app-level restart e2e was not confirmed.

**Why this matters:** Default e2e should be deterministic and runnable without private provider keys. Broad waits and force clicks can make broken readiness or accessibility states look passing. Live-provider dependency makes local preflight less reliable.

**Best fix:**

1. Split deterministic stubbed e2e from opt-in live-provider smoke tests.
2. Make the default `bun run test:e2e` lane require no provider keys.
3. Replace broad waits with app bridge events/state synchronization.
4. Replace force clicks and brittle nth selectors with stable roles/test ids tied to actual UI contracts.
5. Add a real workflow-supervision restart e2e if restart recovery is a shipped contract.
6. Keep the OrbStack lane as the only default e2e execution path, per repo instructions.

**Verification required:**

- `bun run test:e2e` runs without provider keys.
- Opt-in live-provider smoke test is skipped unless explicitly enabled.
- Restart workflow e2e drives app, relaunches, and verifies recovery using bridge/state evidence.
- No new broad waits/retries/force clicks are introduced.

**Documentation impact:** Update e2e setup docs if the OrbStack/default versus live-provider split is not already clear.

**Confidence:** High for retries/live gates/force waits. Medium for exact restart e2e absence until the full test matrix is rechecked.

### AUD-032 - Progress and feature documentation drift from implemented reality

**Impact:** Medium planning and product-source-of-truth issue.

**Precise issue:** `docs/progress.md` has unchecked or stale items for work that appears shipped or partly shipped, and at least one checked item still has `Commit(s): pending`. The repo instructions say progress is forward-looking, completed items should be ticked with landing commits, and stale migration wording should be rewritten to the resolved design.

Confirmed implemented or partly implemented areas:

- Durable unread state in structured session state and runtime tests.
- Dockview mounted/persisted panes and pane-layout e2e coverage.
- TanStack Form use in agent/provider settings forms.
- App Logs virtualized UI.
- Queued messages backend/UI.

Relevant files:

- `docs/progress.md`
- `docs/features.ts`
- `src/bun/structured-session-state.ts`
- `src/renderer/runtime/chat-runtime.ts`
- `src/renderer/components/DockviewWorkspace.svelte`
- `src/renderer/components/AppLogsPane.svelte`
- `src/renderer/components/QueuedMessagesStrip.svelte`

**Why this matters:** The docs are the source of truth for product scope and roadmap. Drift can cause duplicated work, stale priorities, and incorrect assumptions by future agents.

**Best fix:**

1. Audit each stale progress item against source and tests.
2. Rewrite broad items into shipped capability plus explicit remaining gaps.
3. Tick completed items and add the landing commit hash where known.
4. Leave partly complete items unchecked but rewrite them to the actual remaining work.
5. Keep `docs/features.ts` exhaustive and steady-state, not a changelog.

**Verification required:**

- Cross-check each changed progress item against code/tests.
- Run docs format/check as part of `bun run check` where applicable.
- Avoid claiming completion without a source/test reference or commit hash.

**Documentation impact:** This is itself a docs update. It should be done after or alongside code fixes that change scope.

**Confidence:** High that drift exists. Exact completion status for broad items requires line-by-line doc/source reconciliation.

### AUD-033 - Smithers approval, task, artifact, and detail tools drift from native Smithers shapes

**Impact:** High agent-tool correctness and upgradeability issue.

**Disposition:** Fixed. The handler-facing Smithers capability set now delegates native Smithers operations through a Smithers adapter, keeps native Smithers shapes for approvals, node detail, artifacts, transcript, events, run watching, and DevTools streaming, and task-attempt binding uses exact Smithers task-attempt identity.

**Precise issue:** The shipped Smithers-facing tools did not mirror the native Smithers tool schemas documented in the full Smithers reference. Some svvy schemas required fields Smithers treats as optional filters, renamed fields, omitted structured fields, or returned non-native shapes. Task-attempt binding also used recency lookup by resume handle rather than exact current run/node/attempt identity.

Smithers reference facts from `https://smithers.sh/llms-full.txt`:

- `list_pending_approvals` includes fields such as `requestedAtMs`, `decidedAtMs`, `request`, and `decision`.
- `resolve_approval` uses `action: "approve" | "deny"` plus optional filters such as `runId`, `workflowName`, `nodeId`, `iteration`, `note`, `decidedBy`, and structured `decision`; it has ambiguity guards.
- `get_node_detail` returns `{ detail: ... }`.
- `list_artifacts` takes `{ runId, nodeId?, includeRaw? }` and returns an artifact list.

Resolved drift:

- `resolve_approval` accepts native `action`, optional filters, `workflowName`, `decidedBy`, `note`, and structured `decision` payloads.
- Approval resolution delegates to Smithers-native approval behavior instead of editing local DB state directly.
- Pending approval output preserves native fields.
- `list_artifacts`, `get_node_detail`, transcript, event, and frame reads delegate to Smithers-native read models.
- Task-agent execute TypeScript and structured lookup bind attempts by exact Smithers `(runId, nodeId, iteration, attempt)` identity.

Relevant code:

- `src/bun/smithers-tools.ts`
- `src/bun/smithers-runtime/native-adapter.ts`
- `src/bun/smithers-runtime/manager.ts`
- `src/bun/smithers-runtime/workflow-task-agent.ts`
- `src/bun/structured-session-state.ts`
- `docs/references/smithers/src/engine/approvals.ts`

**Why this matters:** The PRD says agent-facing workflow control should expose Smithers-native semantic tools and mirror Smithers naming closely. Drift makes generated/documented calls fail or lose fields, blocks native ambiguity handling, loses structured approval decisions, and can bind task results to the wrong attempt when resume handles repeat.

**Implemented resolution:**

1. Added a Smithers-native adapter for semantic control/read operations.
2. Changed `resolve_approval` to accept native `action`, filters, `decidedBy`, `note`, and structured `decision`.
3. Preserved Smithers-native ambiguity behavior by delegating approval resolution through Smithers.
4. Returned native shapes for pending approvals, node detail, artifacts, transcripts, events, frames, run watching, and DevTools reads.
5. Kept svvy-specific product bindings in `svvy` structured state instead of duplicating Smithers execution facts.
6. Bound task-attempt operations by exact current Smithers context: `runId`, `nodeId`, `iteration`, and attempt id. Resume handles are metadata only and are not ownership lookup keys.

**Verification covered:**

- `src/bun/smithers-tools.test.ts` covers the native `resolve_approval` schema and Smithers tool registration contract.
- `src/bun/smithers-runtime/manager.test.ts` covers native adapter delegation for approvals and read operations.
- `src/bun/smithers-runtime/workflow-task-agent.test.ts` covers exact task-agent capability set and exact resume-session matching.
- `src/bun/structured-session-state.test.ts` covers exact Smithers task-attempt identity uniqueness.

**Documentation impact:** No PRD change if aligning with the current PRD. Update generated tool declarations and any svvy Smithers specs. If svvy intentionally keeps custom shapes, the PRD/features must be rewritten, but that conflicts with current instructions.

**Confidence:** High.

### AUD-034 - Additional extracted issues

This issue groups smaller findings that were still independently actionable. They should be tracked as separate fix tasks even though they were grouped by the audit agents.

#### AUD-034A - Obsolete provider-backed Web private URL guard is syntactic and incomplete

**Disposition:** Obsolete for Web v1. `docs/specs/extension/web.extension.spec.md` defines Web as prompt-only
TinyFish CLI guidance, with TinyFish calls governed as ordinary shell/network execution rather than
a `svvy` native Web provider. This finding is historical evidence for the retired provider-backed
Web implementation and should only become active again if a later product decision adopts a native
or provider-backed Web fetch surface.

**Impact:** Medium security issue only for the obsolete provider-backed web fetch providers.

**Precise issue:** In the obsolete provider-backed Web design, `web_fetch` was supposed to reject local files, private app URLs, localhost, private network, and non-web targets. Current validation is mostly syntactic and test coverage only clearly covers `127.0.0.1`.

Relevant code:

- `src/bun/web-runtime/providers/shared.ts`: obsolete provider-backed Web URL guard helper.
- TinyFish/Firecrawl provider paths that call the shared guard; obsolete under Web v1.

Confirmed gaps to cover:

- Other `127.0.0.0/8` addresses.
- IPv6 loopback `[::1]`.
- IPv6 link-local/private/ULA ranges.
- `0.0.0.0`.
- `169.254.0.0/16`.
- Other reserved/private ranges.
- Provider final URLs after redirects or provider-side fetch resolution.

**Best fix:** Build one robust public-web URL classifier that resolves hostnames/IP literals, rejects private/reserved/local ranges for IPv4 and IPv6, enforces `http`/`https`, and validates both requested URL and final returned URLs/metadata from providers.

**Verification required:** Table-driven tests for every reserved/private class, encoded/IPv6 forms, DNS names resolving to private IPs where resolution is available, redirect/final URL rejection, and valid public URLs.

**Confidence:** High for incomplete guard coverage. DNS/final-URL behavior needs provider-specific tests.

#### AUD-034B - Provider credential storage and precedence do not match copy

**Impact:** Medium confidentiality and settings correctness issue.

**Precise issue:** Credentials are stored as plaintext JSON under the user config directory with file permissions, and stored credentials are read before environment variables. UI copy says environment variables override saved values.

Relevant code:

- `src/bun/auth-store.ts`: config-file credential storage and lookup order.
- `src/renderer/components/Settings.svelte`: password inputs and copy describing env override.

**Why this matters:** Plaintext at-rest provider keys are weaker than OS credential storage. Priority mismatch means users can set an environment override and still use an old saved credential.

**Best fix:**

1. Move provider secrets to OS credential storage, such as macOS Keychain, with a migration-free policy unless explicitly requested.
2. Make environment variables override saved credentials, or update UI copy if saved credentials intentionally win.
3. Keep only non-secret metadata in config files.
4. Ensure bridge/DOM inspection masks password values.

**Verification required:**

- Env var wins over saved value if that remains the copy.
- Removing a saved key removes it from credential storage.
- Config files contain no raw provider key.
- Password inputs are masked in bridge/DOM state.

**Confidence:** Medium-high. Plaintext storage and precedence mismatch are clear; final storage mechanism is a product/security choice.

#### AUD-034C - Saved layout slot switching normalizes but may not hydrate inactive slots

**Impact:** Medium UI persistence issue.

**Precise issue:** Startup applies the active saved layout slot. Switching workspace layout slots normalizes/emits state, but the Dockview component applies `fromJSON` only during creation. Inactive slots may not hydrate correctly when switched later.

Relevant code:

- `src/renderer/runtime/chat-runtime.ts`: startup layout restore and `switchWorkspaceLayout`.
- `src/renderer/components/DockviewWorkspace.svelte`: applies layout JSON on creation.

**Best fix:** Add a shared layout hydration routine that applies the selected slot JSON whenever the active slot changes, guarded by an `applyingLayout` flag so emitted layout-change events do not immediately overwrite the restored slot.

**Verification required:**

- Save two layout slots, switch away, restart, switch to inactive slot, and assert exact pane restoration.
- Ensure applying a slot does not emit a save that overwrites the slot with the pre-apply layout.

**Confidence:** Medium-high from code shape; needs an app-level slot-switch test.

#### AUD-034D - Workflow inspector split uses `paneId`/`panelId` inconsistently

**Impact:** Medium pane-placement issue.

**Precise issue:** The Dockview host passes `panelId`, while `WorkflowInspectorPane` declares and emits `paneId`. Runtime pane-layout APIs expect `panelId`. Split/open actions can therefore target an undefined or wrong pane id.

Relevant code:

- `src/renderer/components/DockviewPanelHost.svelte`
- `src/renderer/components/WorkflowInspectorPane.svelte`
- `src/renderer/pane-layout.ts`

**Best fix:** Standardize on `panelId` end-to-end for Dockview panel placement. Rename component props and emitted payload fields to match the runtime contract.

**Verification required:**

- Workflow inspector split action opens beside the intended panel.
- Type-level coverage prevents `paneId` from being passed where `panelId` is required.

**Confidence:** High.

#### AUD-034E - App-log related links are incomplete

**Impact:** Low-medium observability/navigation issue.

**Precise issue:** App-log related metadata supports some ids and the pane can open some related resources, but surface/thread links are display-only and artifact ids are absent from the related-link model.

Relevant code:

- `src/bun/workspace-contract.ts`: app-log related id model.
- `src/renderer/components/AppLogsPane.svelte`: renders and opens related links.

**Best fix:** Expand related metadata/actions to cover artifact, thread, surface, session, workflow, task, and command ids consistently. Route each through static pane targets where applicable, and make related-link search index those ids.

**Verification required:**

- App-log rows with session/workflow/task/command/thread/surface/artifact metadata render links.
- Each link opens the expected target.
- Search can find logs by related artifact/thread/surface ids.

**Confidence:** High for incomplete related-link coverage.

#### AUD-034F - Double-click rename appears implemented but lacks confirming coverage

**Impact:** Low-medium regression risk.

**Precise issue:** An audit item mentioned double-click rename. Source inspection shows double-click rename behavior appears implemented in the session list item, so this is not a confirmed product bug. The extracted issue is missing or insufficient coverage.

Relevant code:

- `src/renderer/components/SessionListItem.svelte`

**Best fix:** Add a focused component/e2e test that double-clicking a session title enters rename mode, commit updates the session name, and cancel leaves it unchanged.

**Verification required:** The new test should fail if double-click rename is removed or stops dispatching the rename action.

**Confidence:** Medium. The behavior appears present; the actionable gap is coverage.
