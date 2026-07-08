# Desktop Integration Increment Plan

Status: non-authoritative research/planning input. Current behavior is defined by `docs/prd.md`,
`docs/features.ts`, and `docs/specs/**`; roadmap state is tracked in `docs/progress.md`.

Ordered increment plan for running the desktop shell through `@svvy/desktop` over the single
app-owned `ManagedRuntime` with state read/command facades, synthesized from a three-planner
design panel with spec verification on 2026-07-08.

## 1. @svvy/state workspace-store router: state-owned dispatch over app-global + per-workspace stores (spec + ledger + audit, no product cutover)

Scale: large

Build the state-owned router the acceptance rows demand: one app-composed @svvy/state router/layer that dispatches every runtime-facing state-port method, StateReadModels request, StateCommands write, and rebaseline to the correct app-global store or workspace store, keyed by explicit workspaceId/scope or durable globally-resolvable ids (commandId/requestId/approvalId/surfacePiSessionId resolved through committed rows), failing with typed target-not-found otherwise. Per-workspace SQLite stores are RETAINED (no data migration); bootstrap shares the exact StructuredSessionStateStore instances session-catalog already owns through the restricted @svvy/state/structured-session-adapters seam so no second SQLite connection opens per DB. Ship a routing-identity audit: one table-row test per RuntimeLayerRequirements port method (verified list at packages/runtime/src/runtime-layer.ts:222-256) proving routable identity exists in decoded input or committed records; ports lacking identity get explicit scope fields in @svvy/core. state.spec.md export ledger and packages/package-boundaries.test.ts rows updated in the same landing (the state spec's own extension mechanism). No product call sites yet; the shipped per-workspace path stays pinned by its existing tests.

Spec citations:
- docs/progress.md:135-142 — 'core-owned runtime-facing ... state-port contracts carry explicit app/workspace routing identity or globally resolvable committed records, and @svvy/state exposes one app-composed router/layer that dispatches to the correct app-global or workspace store without deriving invalidations from a bound single-workspace store'
- docs/specs/package-architecture/runtime.spec.md:502-504 — 'App/bootstrap does not provide a workspace registry, route resolver, callback table, or alternate runtime implementation' (forces the router into @svvy/state, resolving Plan A's deferral)
- docs/specs/package-architecture/state.spec.md:2180-2181 — 'The port does not infer scope from a bound workspace store'
- docs/specs/package-architecture/state.spec.md:2370-2373 — 'RuntimeRecoveryWorkOwnerScope ... carry enough scope to route through one app-owned runtime state service without relying on a bound single-workspace store'
- docs/specs/package-architecture/state.spec.md:413-416 — 'The restricted @svvy/state/structured-session-adapters subpath exposes only the explicit store-adapter helpers named for the app-bootstrap structured-session state composition edge'
- docs/progress.md:214-217 — 'App bootstrap owns structured-session adapter/store wiring through one approved composition boundary'
- docs/progress.md:17-20 — 'For any big lift or unclear design, add a focused contract or validation step immediately before the production implementation step'

Files:
- /Users/polarzero/code/projects/svvy/packages/state/src/workspace-state-router.ts (new)
- /Users/polarzero/code/projects/svvy/packages/state/src/structured-session-adapters.ts (extend restricted wiring surface)
- /Users/polarzero/code/projects/svvy/packages/state/src/state-facade.ts (readModels/commands/rebaseline routing below the facade seam)
- /Users/polarzero/code/projects/svvy/packages/state/src/index.ts
- /Users/polarzero/code/projects/svvy/packages/core/src/runtime-state-ports.ts (only where a port input genuinely lacks routing identity)
- /Users/polarzero/code/projects/svvy/docs/specs/package-architecture/state.spec.md (router + restricted-subpath symbol rows)
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (export ledger rows)
- /Users/polarzero/code/projects/svvy/src/bun/session-catalog.ts (expose store handles to the adapter boundary; no behavior change)

Test strategy: @effect/vitest layer tests: each routed port method reaches the correct fake/temp-file workspace store by explicit workspaceId/scope, durable-id fan-out via committed owner records, typed target-not-found for unregistered workspaces; after-commit descriptors carry the committed scope (not the store they came from); routing-identity audit test enumerating 100% of RuntimeLayerRequirements port methods; shared-store-instance test proving no second SQLite connection opens for a wired workspace; boundary tests reject non-bootstrap consumers of new restricted symbols.

Landing criteria: check:core-index, typecheck, lint:check, format:check, test:effect, test:unit all green; routing audit covers every port method; state.spec.md union/ledger and packages/package-boundaries.test.ts updated in the same landing; zero product call sites (seam pinned by tests); shipped WorkspaceRuntimeRegistry behavior untouched.

Risks:
- A port method may lack routable identity in its input contract — audit-first ordering surfaces this before cutover; the fix is a core contract change per runtime.spec.md:779-783 with core-index regeneration and type ripple
- Sharing store instances between catalog and router demands single-writer discipline per DB; invalidation descriptors must not fork by store binding
- Exact allowed-symbol set for workspace-store entry into the state graph is spec-authorship (see openQuestions) — land the ledger rows with owner sign-off

## 2. Single app-runtime bootstrap composition module + workspace-routed host ports (new path behind a boundary-pinned seam)

Scale: large

New src/bun/app-runtime-bootstrap.ts composing exactly one ManagedRuntime.make over Runtime.layer: increment-1 state router port layers + workspace-routing implementations of the nine approved bootstrap host ports (RuntimeLayerPromptControlHostPort and RuntimeLayerSurfaceQueueWakePort resolve the owning session-catalog by PromptTarget; RuntimeLayerCommandStdinPort/CommandControlPort over one app-global CommandId-keyed live registry; provider-auth/model-resolver; generated-context/package refresh hosts and RuntimeSourceInvalidationScanPort lifted from WorkspaceRuntimeRegistry) + extensions/sandbox layers built on the concurrently-landed explicit sandbox host-support injection shape of createRuntimeServiceAdapter. Exposes context() + awaitRuntimeStartupReadiness-gated construction, createRuntimeFacade creation, and prepareRuntimeShutdown/dispose ordering. Fully integration-tested against two real temp-file workspace stores; the shipped per-workspace path stays untouched (deleted in increment 3).

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:332-352 — 'const managedRuntime = ManagedRuntime.make(appLayer); ... await managedRuntime.context(); ... await awaitRuntimeStartupReadiness(managedRuntime); } catch ... prepareRuntimeShutdown(managedRuntime, { reason: "startup-failure" })'
- docs/specs/package-architecture/runtime.spec.md:516-521 — 'The semantic-looking public bootstrap host ports are limited to the explicitly listed app-edge ports: RuntimeLayerPromptControlHostPort, RuntimeLayerSurfaceQueueWakePort, RuntimeLayerCommandStdinPort, RuntimeLayerCommandControlPort, RuntimeLayerProviderAuthPort, RuntimeLayerModelResolverPort, RuntimeGeneratedContextRefreshHostPort, RuntimeGeneratedPackageRefreshHostPort, and RuntimeSourceInvalidationScanPort'
- docs/specs/package-architecture/runtime.spec.md:522-525 — prompt control shape 'cancelActivePrompt({ target, turnId }) and cancelPrompt(target) only. It does not resolve defaults, queue work, publish events, materialize prompts, return live pi handles, or receive queued-row payloads'
- docs/specs/package-architecture/runtime.spec.md:491-493 — 'The service admits text only by durable CommandId, never by shell session id or process handle'
- docs/progress.md:806-815 — 'App bootstrap composes the package graph once, creates exactly one app-owned ManagedRuntime ... composes state-port layers and primitive host adapters once'
- docs/progress.md:294-300 — 'Package-boundary checks allow production ManagedRuntime.make(...) only at the app bootstrap owner'

Files:
- /Users/polarzero/code/projects/svvy/src/bun/app-runtime-bootstrap.ts (new) + app-runtime-bootstrap.test.ts (new)
- /Users/polarzero/code/projects/svvy/src/bun/runtime-service-adapter.ts (extract reusable layer glue on the post-fix explicit sandbox host-support injection shape; keep old entry alive)
- /Users/polarzero/code/projects/svvy/src/bun/live-command-stdin-registry.ts (new app-global CommandId-keyed registry)
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (ManagedRuntime.make production allowlist row for the new module)

Test strategy: Integration harness over the new module with two wired workspace catalogs and real temp structured-session stores: workspaces.acquire/acquireDefault/release membership; message submit reaching the correct catalog via wake/prompt-control ports; commands.writeStdin by durable commandId across workspaces; one runtime.events subscription carrying workspace-scoped and app-scoped events on a single monotonic cursor; startup-failure ordering test (context() success + readiness failure → prepareRuntimeShutdown('startup-failure') → dispose exactly once).

Landing criteria: All fast gates green; boundary test pins the new module as the only additional production ManagedRuntime.make site; old WorkspaceRuntimeRegistry path unmodified and still shipped (new path has no product call site except tests, pinned by boundary note).

Risks:
- Depends on the concurrent sandbox host-support injection change at createRuntimeServiceAdapter landing first — build only on the post-fix shape, never the old createPackagedSandboxHostSupportServices() call
- Wake/prompt-control glue must stay primitive: no queued-row payloads, dispatch results, pi handles, or callback functions across the port (runtime.spec.md:547-549) — this seam is transitional and dies in increment 4
- Startup readiness over N workspace stores may surface latent recovery-order assumptions from per-workspace startup

## 3. Cutover: exactly one app-owned ManagedRuntime shipped; per-workspace runtimes deleted; bootstrap lifecycle coordinator

Scale: xlarge

Ship the single runtime and delete the old path in the same landing. WorkspaceRuntimeRegistry loses the runtimes/runtimeFacades maps, per-workspace createCatalogBackedRuntime calls (:553, :754), the app-global runtime record, and mergeRuntimeEventSubscriptions (:1145); it becomes the opened-workspace host registry (catalog lifecycle, WorkspacePathIndex, agent-settings store, app-log facades, source-invalidation coordinator handles, workspace identity records only — factoring explicitly permitted by desktop.spec.md:134-137). workspace-rpc-routing returns THE bootstrap facade for every handler; workspaceId is used only to validate an open workspace record / renderer binding. Workspace open/close flows through runtime.workspaces.acquire/acquireDefault/release plus catalog host registration. runtime-service-adapter shrinks to composition glue consumed once by app-runtime-bootstrap; internal launchFacts/acceptedNativeTools/refresh adapters become app singletons; catalog runtimeForRecovery callbacks re-point at the single runtime. Add the idempotent app lifecycle coordinator (grafted from Plan C): startup-failure surface with no facades exposed, shutdown marks bridge closed → rejects new calls with typed shutdown → closes subscription/callback scopes → prepareRuntimeShutdown → single dispose; restart never overlaps two healthy runtimes.

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:440-454 — 'The product process exposes exactly one healthy app-owned ManagedRuntime per app-runtime instance ... Per-workspace runtime adapters are not part of the shipped @svvy/desktop contract ... No workspace runtime scope, renderer module, window, browser-tool adapter, headless adapter, or RPC handler constructs its own ManagedRuntime, calls ManagedRuntime.make(...)'
- docs/specs/package-architecture/desktop.spec.md:766-770 — 'Desktop bridge code may use workspaceId only to validate renderer panel binding or choose renderer transport. It must not select a workspace runtime scope, runtime facade, process handle, or command session by workspaceId'
- docs/progress.md:143-147 — 'App bootstrap owns exactly one composed app ManagedRuntime ... workspace registries ... do not create per-workspace runtimes, store runtime facades as workspace state'
- docs/specs/package-architecture/runtime.spec.md:1713-1727 — 'workspaces.acquire(...) starts or reuses the runtime-owned workspace scope-manager entry, runs the workspace readiness gate ... workspaces.release(...) releases one owner ref'
- docs/specs/package-architecture/runtime.spec.md:3097-3103 — 'A per-workspace ManagedRuntime or per-workspace RuntimeEventBus is invalid even if each individual bus is package-private, because it creates multiple public cursor spaces'
- docs/specs/package-architecture/desktop.spec.md:409-422 — 'Default-workspace creation, tab retargeting, renderer bridge registration, browser-tool bridge registration, and window startup run only after this bootstrap readiness gate succeeds'
- docs/progress.md:326-328 — 'App/bootstrap owns an idempotent shutdown coordinator that rejects new bridge calls, closes facade subscription/callback scopes ... and then calls managedRuntime.dispose()'

Files:
- /Users/polarzero/code/projects/svvy/src/bun/workspace-runtime-registry.ts (major rewrite → workspace host registry)
- /Users/polarzero/code/projects/svvy/src/bun/workspace-rpc-routing.ts (rewrite: single facade; workspaceId validation-only)
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (bootstrap sequencing: single runtime before window startup; RPC handlers on the single facade)
- /Users/polarzero/code/projects/svvy/src/bun/app-lifecycle-coordinator.ts (new) + test
- /Users/polarzero/code/projects/svvy/src/bun/runtime-service-adapter.ts (delete per-workspace runtime construction)
- /Users/polarzero/code/projects/svvy/src/bun/session-catalog.ts (drop port-provider getters consumed only by the old adapter path; prompt execution stays behind pinned wake/prompt-control ports)
- /Users/polarzero/code/projects/svvy/src/bun/workspace-runtime-registry.test.ts + workspace-rpc-routing/adapter/catalog test retargets
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (ManagedRuntime.make allowlist narrowed to app-runtime-bootstrap)

Test strategy: Retarget existing registry/adapter/catalog unit tests to the new seam: acquire/release drive runtime.workspaces.* plus store/host registration; assert no second ManagedRuntime constructed (boundary check + spy). RPC contract tests: workspaceId mismatch/unopened workspace rejects with typed error and never selects a different runtime. One-cursor event test replacing mergeRuntimeEventSubscriptions. Lifecycle coordinator tests: failure before context() disposes without prepareRuntimeShutdown; after context() calls it with startup-failure; post-shutdown calls reject typed; concurrent shutdown observes one receipt; restart never exposes two healthy runtimes. Full ~1623-test bun suite as the regression net; manual app-boot smoke: two workspaces open, prompt round-trip via the catalog behind pinned wake/prompt-control ports, clean shutdown with exactly one dispose.

Landing criteria: All fast gates green including rewritten registry/adapter/routing tests; production ManagedRuntime.make pinned to app-runtime-bootstrap only; runtimeFacades map, createCatalogBackedRuntime call sites, and mergeRuntimeEventSubscriptions deleted in this landing (no competing runtime path remains); app boots, opens default + second workspace, runs a prompt, disposes once.

Risks:
- Highest blast radius so far: startup readiness and workspace recovery previously ran once per per-workspace ManagedRuntime; after cutover they split between app startup (app scope) and workspaces.acquire (workspace scope) — behavior parity needs explicit tests
- Catalog runtimeForRecovery promise wiring re-pointed at app singletons may change ordering during workspace open
- Browser-tools dev bridge and svvyx subprocess paths reference registry active-runtime accessors; they must move to the single facade or workspace-host records
- Event sequence becomes app-global; renderer still fed by catalog sync in this increment (no renderer impact), but any per-workspace sequence assumption breaks
- Transitional state is legal and pinned: prompt execution still runs in the catalog behind the spec-named RuntimeLayerSurfaceQueueWakePort/PromptControlHost bootstrap primitives; the seam is boundary-pinned and retired wholesale in increment 4

## 4. Pi absorption: session-catalog prompt/pi-session execution moves into runtime-owned workspace/surface scopes inside Runtime.layer

Scale: xlarge

Retire the deepest coupling and unblock the entire renderer steady state: Runtime.layer gains its spec-required @svvy/pi-adapter dependency and owns pi-session materialization, queue claim/dispatch, prompt-turn execution, and surface event publication. surfaces.createOrchestrator/open acquire retained runtime-owned surface scopes (keyed by durable surfacePiSessionId under the workspace scope) owning the live pi session handle, prompt lock, and active prompt fiber via PiAdapter.sessions.create/open; the generic createSurfaceQueueDispatcher (packages/runtime/src/surface-queue-dispatcher.ts) is instantiated inside Runtime.layer with a runtime-owned dispatch host over PiAdapter + Extensions (prompt defaults, actor binding, generated-context build before dispatch), replacing the catalog's ManagedSession loop. The runtime pi-event consumer becomes the sole translator of pi deltas into surface.stream patches, giving RuntimeSurfaceEventPublisher.publishStreamPatch its FIRST production callers (verified: zero today). The catalog's prompt/dispatch/pi code (including emitSurfaceStreamPatch at session-catalog.ts:3517-3540) and the wake/prompt-control delegation into it are deleted in the same landing; session-catalog reduces to structured-session store owner / state-port router leaf plus legacy read/snapshot builders that survive until increments 6/10. App edge adapts runtime surface.stream events into the existing renderer sync channel until increment 10, so the renderer feed never has two producers.

Spec citations:
- docs/progress.md:25-28 — Current Baseline row: 'over the single healthy app-owned ManagedRuntime, with app-bootstrap runtime event subscription/fanout to renderer-safe notifications, renderer rebaseline handling, and @svvy/pi-adapter owned below runtime' (uncheckable without this increment)
- docs/specs/package-architecture/runtime.spec.md:732-738 — 'RuntimePromptExecutionService materializes a claimed queued message into pi work through @svvy/pi-adapter, owns the active-turn fiber, stream consumption, tool-call acceptance, command facts, prompt cancellation, title scheduling, queue settlement, and runtime event publication'
- docs/specs/package-architecture/runtime.spec.md:740-745 — 'RuntimeSurfaceRuntimeService is the scoped value acquired from the runtime-owned surface scope manager for one durable surfacePiSessionId. The scoped value owns the live pi session handle, prompt lock, active prompt fiber, surface-local wait registries, command session handles, and finalizers'
- docs/specs/package-architecture/runtime.spec.md:4678-4690 — 'Runtime then starts one active turn fiber under the surface prompt lock and receives PiAdapterTurnStream from @svvy/pi-adapter ... The stream consumer is the only owner that may translate pi deltas into live surface.stream patches'
- docs/specs/package-architecture/runtime.spec.md:1725-1734 — 'The pi session is created only inside that retained surface scope through PiAdapter.sessions.create(...); it is not a method-local handle, desktop-pane resource, or app/bootstrap-owned session'
- docs/specs/package-architecture/runtime.spec.md:3043-3046 + 3087-3088 — 'RuntimeSurfaceEventPublisher is the package-private runtime-owned service for constructing surface.stream and surface.changed events before handing them to RuntimeEventBus ... Desktop, browser-tool, headless, state, and extension code do not import or call RuntimeSurfaceEventPublisher' (no host path exists for catalog stream publication — this increment is the only spec-legal producer)
- docs/progress.md:677-697 — 'Package-private RuntimePromptExecutionService and the required @svvy/pi-adapter session/turn APIs materialize claimed queued messages into pi turns ... The complete pi turn/tool-call loop runs inside @svvy/runtime ... surface scope services acquire each surface's scoped Effect resource used when calling @svvy/pi-adapter sessions.create(...)'
- docs/progress.md:869-874 — 'Runtime pi-event consumers and surface lifecycle services publish core surface.stream and surface.changed runtime events ... through the runtime event bus; app/bootstrap maps those events to renderer-safe notifications'

Files:
- /Users/polarzero/code/projects/svvy/packages/runtime/src/runtime-layer.ts (PiAdapter/Extensions-backed prompt execution + surface scope manager wiring)
- /Users/polarzero/code/projects/svvy/packages/runtime/src/surface-runtime-scope-service.ts (new; sibling of workspace-runtime-scope-service.ts)
- /Users/polarzero/code/projects/svvy/packages/runtime/src/runtime-prompt-execution-service.ts (new) + pi-event consumer modules
- /Users/polarzero/code/projects/svvy/packages/runtime/src/surface-queue-dispatcher.ts (production dispatch-host instantiation, package-private)
- /Users/polarzero/code/projects/svvy/packages/runtime/src/runtime-surface-event-publisher.ts (gains production callers)
- /Users/polarzero/code/projects/svvy/src/bun/session-catalog.ts (delete ManagedSession prompt/dispatch/pi-session path incl. emitSurfaceStreamPatch; keep store owner + legacy read builders)
- /Users/polarzero/code/projects/svvy/src/bun/app-runtime-bootstrap.ts (layer gains pi-adapter bundle; drop wake/prompt-control catalog delegation per final ledger)
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (app-edge adaptation of runtime stream events into existing renderer sync channel until increment 10)
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (reject catalog prompt entry points; bootstrap export ledger updates)
- /Users/polarzero/code/projects/svvy/packages/runtime/src/*.effect.test.ts (dispatch/prompt/stream lifecycle coverage)

Test strategy: @effect/vitest with fake PiAdapter layer + TestClock: queue claim → turn-row commit → startPrompt → ordered stream patches with per-surface streamGenerationId/streamSequence; cancellation interrupts the prompt fiber and settles queue/turn/command rows; surface scope close releases the pi handle. Exhaustive parity checklist derived by reading the ManagedSession dispatch path BEFORE coding: title-generation scheduling, request-input blocking/nonblocking delivery, approval waits, accepted native tools, artifact facts, workflow task-agent starts, steering, generated-context refresh before dispatch, telemetry. Integration: two-workspace single runtime, submit → surface.stream observed on runtime.events. OrbStack e2e live prompt round-trip.

Landing criteria: All fast gates green; no dual prompt path exists (catalog dispatch deleted in the same landing; boundary test rejects reintroduction); runtime.events carries surface.stream/surface.changed for live prompts; e2e prompt round-trip green; bootstrap export ledger rows for the retired wake/prompt-control delegation updated in the same landing.

Risks:
- Largest, riskiest increment in the plan: the catalog prompt loop embeds years of behavior — the parity checklist must be authored exhaustively before implementation
- If it cannot land in one PR, the only safe internal split is (4a) surface-scope pi-session ownership with the catalog delegating retainSurface/releaseSurface to runtime, then (4b) dispatch + stream publication — each sub-landing gate-green with a boundary test pinning the delegation seam so no two competing claim paths exist
- pi-adapter session behavior differences vs catalog ManagedSession (ambient resource suppression, prompt rebinding, history fork) surface only under e2e
- RuntimeLayerSurfaceQueueWakePort semantics invert (wake hints into runtime instead of runtime→catalog callback); requires Extensions package services (generatedContext.build, nativeTools) to be production-real — verify before starting, not mid-increment

## 5. State facades constructed at bootstrap; existing command groups routed through runtime post-commit publication

Scale: medium

Wire the already-implemented, currently call-site-less facades (verified: createStateFacade at packages/state/src/state-facade.ts:332, createStateCommandsFacade at :378, zero imports in src/): bootstrap constructs state = createStateFacade(managedRuntime), stateCommands = createStateCommandsFacade(managedRuntime), and the narrowed RendererStateFacade (fetch/refetchInvalidation/rebaseline only; close() stays bootstrap-private), over the increment-1 routed StateReadModels/StateCommands/AppLogState providers. StateCommandPostCommitNotificationPort is supplied by Runtime.layer so every command resolves only after runtime-owned publication accepts committed descriptors. Existing RPC mutations for app-log read state, app preferences/settings, and provider auth re-route through stateCommands (the three groups verified implemented today); the renderer refetches the five currently-supported read-model kinds (appLogs, appLogSummary, appPreferences, settings, providerAuth) through the renderer state facade RPC surface.

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:354-357 — 'const state = createStateFacade(managedRuntime); const stateCommands = createStateCommandsFacade(managedRuntime); const rendererState = narrowRendererStateFacade(state)'
- docs/specs/package-architecture/desktop.spec.md:264-267 — 'It exposes only read-model fetch, invalidation refetch, and rebaseline methods. The full app-owned state facade, including close(), remains private to app/bootstrap'
- docs/specs/package-architecture/desktop.spec.md:486-489 — 'The bootstrap-created StateCommandsFacade runs its state writes through the app ManagedRuntime and resolves only after the runtime-owned event publication path has accepted the committed descriptors. @svvy/runtime is the sole publisher on the public event stream'
- docs/progress.md:383-388 — 'createStateCommandsFacade(managedRuntime) covers every product state command group ... containing StateCommands and the runtime-provided StateCommandPostCommitNotificationPort'
- docs/specs/package-architecture/desktop.spec.md:475-480 — 'State-backed command facades expose only the named StateCommandsFacade groups specified by @svvy/state ... and app-log read-state commands'

Files:
- /Users/polarzero/code/projects/svvy/src/bun/app-runtime-bootstrap.ts (facade construction after readiness)
- /Users/polarzero/code/projects/svvy/src/bun/renderer-state-facade.ts (new: narrowRendererStateFacade)
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (preferences/provider-auth/app-log read-state handlers route through stateCommands; readModels RPC handlers)
- /Users/polarzero/code/projects/svvy/src/shared/workspace-contract.ts (renderer read/command RPC surface for the five kinds)
- /Users/polarzero/code/projects/svvy/src/mainview/ app-log/settings/provider-auth stores (fetch via renderer state facade)
- /Users/polarzero/code/projects/svvy/src/bun/removed-contracts.test.ts (new: pin retired direct-store RPC paths)

Test strategy: Integration over the single runtime: stateCommands.appLogs.markRead commits and the committed invalidation is observed on runtime.events BEFORE the facade promise resolves (post-commit ordering). Routed StateReadModels tests: workspace-scoped fetch dispatches to the owning store; app-scoped kinds hit the app-global store. Facade abort/interruption mapping tests (progress.md:370-373). RPC handler tests against fake bootstrap-provided facades; retired direct-store mutation paths pinned by removed-contracts tests.

Landing criteria: All fast gates green; preferences/provider-auth/app-log mutations no longer reach catalog/agent-settings mutation paths directly from RPC handlers (pinned); renderer facade exposes exactly fetch/refetchInvalidation/rebaseline; unmigrated legacy handlers enumerated in a seam test.

Risks:
- appPreferences/settings live today in the file-backed agent-settings-store while StateCommands.appPreferences writes state-owned rows — adapter vs one-time-import decision (openQuestion 3)
- Post-commit publication coupling: facade resolution must not deadlock against the event bus under shutdown
- StateReadModels service construction assumes one StructuredSessionState + one AppLogState (state-facade.ts:503-517); keep routing below the service-construction seam so facade semantics do not fork

## 6. State read-model kind expansion + remaining StateCommands groups (spec-first union extension, builders, parity fixtures)

Scale: xlarge

Extend the StateReadModelRequest/Result union (currently exactly five kinds, state.spec.md:553-565) and implement builders + invalidation mappings + rebaseline coverage for every renderer-required kind, editing state.spec.md's union in the SAME landing per its own extension rule: surfaceTranscript and commandInspector (shapes ALREADY spec'd — verified at state.spec.md:3134-3159 and :3161-3190; Plan A's 'unspecified' claim is wrong), sessionNavigation (existing @svvy/state/session-navigation projection), surface summary/composer/queued-message slices, requestInput, approvals, agents, extensions, snippets, workflowsGenerated, handler/workflow-task-attempt inspectors, and the workspace chrome/layout/panel-binding kind that increment 7's panel-binding validation requires. Builders port the catalog's read paths (listSessions, getCommandInspector, buildSurfaceSnapshot, getSnippets, etc.) over the increment-1 routed stores. Add the missing StateCommands groups (workspaceChrome, workspaceLayout, agentProfiles, snippets, extensionEnv — verified absent from state-facade.ts today) with idempotent receipts and committed afterCommit descriptors through the post-commit port. Golden parity tests pin new builders against current catalog outputs on fixture stores. No renderer cutover yet.

Spec citations:
- docs/specs/package-architecture/state.spec.md:614-616 — '@svvy/state exposes exactly the StateReadModelRequest.kind and StateReadModelResult.kind union declared above. Additional read-model kinds are not package-root facade contracts unless this spec names their request/result variants, builders, invalidation mappings, root exports, and tests' (the extension mechanism this increment executes)
- docs/specs/package-architecture/state.spec.md:3134-3159 — 'type SurfaceTranscriptReadModel = { target ... surfaceStatus ... promptLock ... composerDraft ... messages ... }' (already authored)
- docs/specs/package-architecture/state.spec.md:3161-3190 — 'type CommandInspectorReadModel = { commandId; status; ... output ... stdin ... }' (already authored)
- docs/specs/package-architecture/state.spec.md:626-639 — 'Workspace { model: "surface", ids } descriptors expand into every open surface-scoped read request ... Every StateReadModelRequest.kind in the package-root facade has a matching read-model builder, invalidation mapping where applicable, root export, and positive/negative contract tests'
- docs/progress.md:218-224 — 'StateCommands exposes the full command facade groups ... StateReadModels supports every StateReadModelRequest.kind in the state spec, including workspace, session navigation, surface, transcript, command inspector, handler inspector, request input, approvals, agents, extensions, settings, provider auth, app preferences, snippets, workflows generated'
- docs/specs/package-architecture/desktop.spec.md:720-724 — 'the desktop bridge resolves the current panel binding from the state read facade using an authoritative read-model revision' (layout/panel-binding kind is a hard dependency of increment 7)

Files:
- /Users/polarzero/code/projects/svvy/docs/specs/package-architecture/state.spec.md (union + read-model + command-group contract rows)
- /Users/polarzero/code/projects/svvy/packages/state/src/state-facade.ts (union, dispatch, rebaseline)
- /Users/polarzero/code/projects/svvy/packages/state/src/read-models/*.ts (new builder modules ported from session-catalog read paths)
- /Users/polarzero/code/projects/svvy/packages/state/src/structured-session-projections.ts + structured-session-selectors.ts (reuse/extend)
- /Users/polarzero/code/projects/svvy/packages/state/src/state-command-schemas.ts + new command modules
- /Users/polarzero/code/projects/svvy/packages/core/src/ (renderer/RPC transport schemas for new read models; DTO contracts)
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (root export ledger rows)
- /Users/polarzero/code/projects/svvy/packages/state/src/*.test.ts (builder/invalidation/rebaseline/parity tests)

Test strategy: Per-kind positive/negative contract tests over fixture structured-session stores; invalidation-descriptor → refetch mapping tests for each committed mutation family including the workspace surface-descriptor expansion; rebaseline returns baselines including new kinds per workspace/target scope; golden parity tests catalog-read vs state-builder on the same store (transcript, navigation, inspectors); per-group command tests with idempotent receipts and post-commit acceptance; negative tests rejecting non-union kinds.

Landing criteria: All fast gates green; spec union, facade union, builders, root exports, ledger rows, and tests updated together in each landing (check:core-index regenerated); parity fixtures prove no data loss vs catalog reads; renderer still on legacy reads (no dual consumer).

Risks:
- Broadest state work in the plan; transcript projection is the hardest port (pi transcript substrate → committed pi-free slices) and may reveal facts not yet persisted, needing small state-port additions
- May land as kind-family sub-landings (navigation/inspectors → panes → transcript last), each spec+ledger complete for its kinds and gate-green
- The un-spec'd request/result shapes need owner sign-off before implementation (openQuestion 1)
- Descriptor granularity vs read-model slices (state.spec.md:628-635) constrains renderer refetches — get expansion right or increment 10 churns

## 7. Spec-named desktop bridge contracts: core-hoisted error schema, submit normalization with panel-binding authority, stdin request, sequence-aware refetcher

Scale: medium

Land the four missing spec-named artifacts (verified absent from the entire repo): (a) DesktopBridgeErrorContractSchema hoisted to @svvy/core — the closed six-reason union with BoundaryIssueSchema/Defect fields matching core's existing StateStoredErrorSchema pattern (packages/core/src/errors.ts:90-103); the bun bridge validates/normalizes with the schema, renderer receives only the plain DTO type (effect imports are banned from desktop/mainview/shared). All bridge handlers normalize failures into it with no raw Cause/stack leakage. (b) DesktopSubmitPromptRequest: bridge normalizes composer submission to panelId+target+text+attachments+clientRequestId, resolves the current panel binding from the increment-6 layout read model at an authoritative revision (renderer cache optimistic-only), rejects mismatch with typed invalid-panel-binding, calls runtime.messages.submit; SendPromptResponse.snapshot (verified at src/shared/workspace-contract.ts:492-497) is deleted — durable acceptance receipt only, live updates from increment-4 stream events. (c) DesktopWriteCommandStdinRequest delegating to runtime.commands.writeStdin by durable commandId only. (d) createSequenceAwareRefetcher as a plain src/mainview helper (per-target sequence coalescing, stale-refetch discard, command-invalidation same path), API matched to the DesktopRendererNotification variants.

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:726-746 — 'Desktop-owned pre-runtime validation failures and renderer/RPC adaptation failures use a closed DesktopBridgeErrorContractSchema composed from @svvy/core ids plus boundary issue schemas' (exact Schema.Struct given)
- docs/specs/package-architecture/desktop.spec.md:843-845 — '@svvy/desktop, src/mainview/**, and src/shared/** must not import effect/* or depend on effect' + :812-813 'The bridge validates inbound RPC payloads with hoisted @svvy/core schemas' (together force the Schema value into @svvy/core, resolving Plan B's placement question)
- docs/specs/package-architecture/desktop.spec.md:692-724 — 'type DesktopSubmitPromptRequest = { panelId; target; text; attachments?; clientRequestId } ... must not contain messages, systemPrompt, toolDeclarations, generatedContext, panelSnapshot ... the desktop bridge resolves the current panel binding from the state read facade using an authoritative read-model revision ... A mismatch fails with a typed desktop bridge validation error'
- docs/specs/package-architecture/desktop.spec.md:628 — messages.submit returns 'durable acceptance receipt only: accepted queuedMessageId, target, and status: "queued"'
- docs/specs/package-architecture/desktop.spec.md:749-764 — 'type DesktopWriteCommandStdinRequest = { commandId: CommandId; text: string; clientSubmission?: RuntimeClientSubmissionInput }' delegating to runtime.commands.writeStdin
- docs/specs/package-architecture/desktop.spec.md:531-535 + 612-616 — 'createSequenceAwareRefetcher({ state, applyReadModelPatch, discardIfStale: true }) ... A slower refetch result for an older event sequence is discarded ... Command-facade invalidation handling uses the same sequence-aware path'

Files:
- /Users/polarzero/code/projects/svvy/packages/core/src/desktop-bridge-error-contract.ts (new) + core index + regenerated core-public-symbol-index
- /Users/polarzero/code/projects/svvy/src/shared/workspace-contract.ts (SendPromptRequest/Response reshape; DesktopSubmitPromptRequest/DesktopWriteCommandStdinRequest DTO types)
- /Users/polarzero/code/projects/svvy/src/bun/desktop-bridge-requests.ts (new: normalization + panel-binding validation + error normalization)
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (sendPrompt ~:2390 and writeCommandStdin ~:2143 handlers)
- /Users/polarzero/code/projects/svvy/src/mainview/sequence-aware-refetcher.ts (new) + test
- /Users/polarzero/code/projects/svvy/src/mainview/chat-runtime.ts (submit path stops consuming response snapshot)
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (ledger rows)

Test strategy: Schema accept/reject rows for all six reason literals, no raw Cause/stack leakage; forbidden-field payloads (messages/systemPrompt/toolDeclarations/generatedContext/panelSnapshot) rejected pre-runtime; panel-binding mismatch → invalid-panel-binding; happy path returns queued receipt only; writeStdin RPC test proving durable commandId routing, workspaceId used only for binding validation, typed shutdown rejection (desktop.spec.md:888-891); refetcher tests for stale-discard, per-target coalescing, rebaseline reset (desktop.spec.md:893-894).

Landing criteria: All fast gates green; boundary test proves prompt submission carries only target+message+delivery+telemetry (progress.md:290-293); composer works via increment-4 stream events without the response snapshot (smoke via run-app lane); refetcher covered in isolation, wired in increment 8.

Risks:
- Hard dependency on increment 6's layout/panel-binding read model — do not fall back to renderer cache as authority (desktop.spec.md:721-723)
- Dropping SendPromptResponse.snapshot changes the composer optimistic-update path; requires increment-4 stream events live (they are, by ordering)
- PromptTarget vs RuntimeSurfaceTarget divergence at the normalization seam between shared contract and core schemas

## 8. App/bootstrap DesktopNotificationBridge: runtime-event → DesktopRendererNotification fanout + app-scoped pane migration

Scale: large

Implement createDesktopNotificationBridge in app/bootstrap over the single runtime facade: subscribes runtime.events with an explicit app-scope subscription plus workspace scopes resolved from state-backed workspace/tab read models (never caller-supplied scopes or focused-pane routing); maps events per the exact eight-row table (surface.stream → surface-stream-patch only for current generation and contiguous sequence, else read-model-rebaseline-required; command/queue/turn/surface/app_read_model/workspace_read_model/runtime.recovery → read-model-changed with the exact descriptor); validates scope/descriptor consistency before fanout (inconsistent → rebaseline-required); tracks sequence, detects gaps, handles slow-consumer closes with rebaselineRequired; emits app-shutdown/renderer-command lifecycle notices. Bridge lifecycle is shaped as DesktopNotificationBridge {start,stop} for increment 9's createDesktopApp input. Renderer gains one notification listener store feeding the increment-7 refetcher; the already-supported app-scoped panes (appLogs, settings, providerAuth, appPreferences) switch to notification-driven refetchInvalidation and their legacy push channels are deleted in the same landing. Remaining legacy surface/workspace sync channels are enumerated in a pinning seam test, each entry mapped to the increment that retires it.

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:287-298 — 'Runtime event to renderer notification mapping is exact:' (full table)
- docs/specs/package-architecture/desktop.spec.md:305-308 — 'DesktopRendererNotification.scope is derived from the runtime event target and must be consistent with the attached StateInvalidationDescriptor. App/bootstrap validates that consistency before fanout'
- docs/specs/package-architecture/desktop.spec.md:394-405 — 'App/bootstrap resolves the authoritative workspaceId from state-backed workspace/tab read models before app/bootstrap calls runtime.events({ workspaceId, afterSequence }) ... App-global notifications use an explicit app subscription scope with no workspace fallback. The bridge must not route runtime events by focused pane, selected Dockview tab, last opened workspace'
- docs/specs/package-architecture/desktop.spec.md:796-805 — 'the bridge closes only that subscriber with { reason: "slow-consumer", eventGenerationId, lastContiguousSequence, rebaselineRequired: true } ... and requires state.readModels.rebaseline(...) before resubscribe'
- docs/progress.md:231-234 — 'App/bootstrap exposes only renderer-safe desktop notifications derived from runtime events ... raw RuntimeEvent values stay below the bootstrap fanout boundary'

Files:
- /Users/polarzero/code/projects/svvy/src/bun/desktop-notification-bridge.ts (new) + desktop-notification-bridge.test.ts (new)
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (fanout wiring; delete legacy app-log/settings/provider-auth push paths)
- /Users/polarzero/code/projects/svvy/src/shared/workspace-contract.ts (DesktopRendererNotification RPC channel contract)
- /Users/polarzero/code/projects/svvy/src/mainview/renderer-notifications.ts (new) + tests
- /Users/polarzero/code/projects/svvy/src/mainview/ app-log/settings/provider-auth stores (notification-driven refetch)
- /Users/polarzero/code/projects/svvy/src/bun/legacy-sync-seam.test.ts (new: enumerates remaining pinned channels)

Test strategy: Bridge unit tests against fake runtime event subscriptions: exact per-row mapping assertions; sequence gap → read-model-rebaseline-required with no invented state; scope/descriptor inconsistency downgrades to rebaseline; slow-consumer close payload handling; subscription disposal on window close/workspace close/renderer unsubscribe/runtime restart/app shutdown with distinct close reasons (desktop.spec.md:829-833, 885-887); publication never blocks on Electrobun callback delivery. Renderer store tests: stale refetch discarded by sequence; workspace-mismatched notifications dropped/rebaselined.

Landing criteria: All fast gates green; appLogs/settings/providerAuth/appPreferences panes provably notification-driven with legacy push channels deleted; remaining snapshot/sync channels enumerated in the seam test with retirement increments named; bridge lifecycle matches the DesktopNotificationBridge {start,stop} contract.

Risks:
- App-runtime sequence (subscription/refetch cursor) vs streamSequence (per-surface patch cursor) must never conflate (desktop.spec.md:781-786) — the refetcher and bridge encode this split before renderer migration
- Slow-consumer semantics depend on runtime event-bus close DTO exactness — verify against packages/runtime/src/runtime-event-bus.ts, not assumptions
- Electrobun callback handoff queue must not create a second product-level cursor/replay buffer (desktop.spec.md:795-799)

## 9. Bootstrap through createDesktopApp: Electrobun host adapters own window/menu/bridge lifecycle; monolith shell construction deleted

Scale: large

src/bun/index.ts stops constructing BrowserWindow/ApplicationMenu/RPC inline (verified at :2848-2873, :1061) and boots via the spec's normative sequence: after the readiness gate, construct runtime facade, state facades, narrowed renderer facade, commands bundle, the increment-8 notification bridge, and an Electrobun DesktopHostAdapter (bridge.exposeRendererApi wrapping defineElectrobunRPC over injected facades with disposable registration; sendToRenderer forwarding DesktopRendererNotification; windows.createMainWindow wrapping BrowserWindow incl. traffic-light positioning; menus.installAppMenu routing commandPalette/quickOpen/openSettings through renderer-command notifications; browserTools status/openInspector labels only), then run await createDesktopApp({ runtime: omit(events/close/commands), state: rendererState, commands, notifications, host }).start(). Startup failure shows the failure surface and rejects bridge calls with the normalized startup error; dispose flows through createDesktopApp.dispose → increment-3 lifecycle coordinator → prepareRuntimeShutdown → single managedRuntime.dispose. This gives packages/desktop/src/index.ts its first product call site. Remaining legacy RPC handlers (panes not yet migrated) are carried as app/bootstrap-owned handlers over injected facades, pinned by a contract test enumerating them, and deleted in increment 10 — keeping this shell swap a contained, reviewable diff (grafted from Plan B).

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:119-129 — 'await createDesktopApp({ runtime: runtimeActions, state, commands, notifications, host }).start()'
- docs/specs/package-architecture/desktop.spec.md:326-384 — 'Target product app bootstrap shape' (ManagedRuntime.make → context() → awaitRuntimeStartupReadiness → facades → createElectrobunDesktopHostAdapter → createDesktopNotificationBridge → createDesktopApp)
- docs/specs/package-architecture/desktop.spec.md:91-95 — '@svvy/desktop root exports exactly one callable value, createDesktopApp(input) ... it never receives a raw ManagedRuntime'
- docs/specs/package-architecture/desktop.spec.md:309-321 — 'createDesktopApp(...) owns desktop/window/renderer lifecycle only ... Host adapters are UI host adapters only. They may create windows, install menus, expose renderer RPC ... must not create package layers, run Effect programs, publish runtime events'
- docs/specs/package-architecture/desktop.spec.md:414-422 — startup failure is terminal for that runtime instance; 'Default-workspace creation, tab retargeting, renderer bridge registration, browser-tool bridge registration, and window startup run only after this bootstrap readiness gate succeeds'
- docs/progress.md:25-28 — 'Run the Electrobun desktop shell as @svvy/desktop only through app/bootstrap-injected renderer-safe runtime and state read/command facades over the single healthy app-owned ManagedRuntime'

Files:
- /Users/polarzero/code/projects/svvy/src/bun/electrobun-desktop-host.ts (new: bridge/window/menu/browser-tools adapters) + tests
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (major shrink: config/env resolution + bootstrap sequence + createDesktopApp call)
- /Users/polarzero/code/projects/svvy/src/bun/startup-failure-surface.ts (new or extended)
- /Users/polarzero/code/projects/svvy/src/bun/app-lifecycle-coordinator.ts (dispose ordering through createDesktopApp.dispose)
- /Users/polarzero/code/projects/svvy/src/bun/app-menu.ts + app-menu.test.ts (retarget to renderer-command notifications)
- /Users/polarzero/code/projects/svvy/packages/desktop/src/desktop-app.test.ts (extend beyond the 3 existing lifecycle tests)
- /Users/polarzero/code/projects/svvy/src/bun/legacy-rpc-handlers seam contract test (enumerates carried handlers)

Test strategy: Host-adapter unit tests with fake Electrobun handles: exposeRendererApi registers handlers bound to injected facades and dispose() unregisters; menu actions emit renderer-command notifications; window handle dispose ordering. Bootstrap sequencing tests: facades/bridge/window unreachable when readiness fails; startup failure runs prepareRuntimeShutdown('startup-failure') then dispose and bridge calls reject with the normalized startup error. Dispose ordering matches createDesktopApp's disposeStartedResources then bootstrap runtime disposal. Real app-boot smoke via the run-app lane: window, menus, RPC, notifications through the adapter path.

Landing criteria: All fast gates green; app launches and shuts down through createDesktopApp (lifecycle tests + smoke); no BrowserWindow/ApplicationMenu/RPC construction outside the host adapter module (source-scan/boundary pin); carried legacy handlers enumerated with retirement mapping.

Risks:
- Electrobun BrowserWindow requires the rpc object at construction (index.ts:2862-2872) — the bridge adapter may need a deferred-handler RPC shim to fit createDesktopApp's bridge-before-window ordering (packages/desktop/src/index.ts start sequence) without leaking Electrobun types into @svvy/desktop
- Dev browser-tools bridge and Updater/local-info flows interleaved with window startup (index.ts:2875-2921) must become app/bootstrap edges beside, not inside, desktop host adapters (desktop.spec.md:553-556, 606-610)
- Traffic-light/native positioning needs a home in the window adapter

## 10. Renderer read-model migration: transcript + panes onto state facades and notifications; snapshot RPC contracts deleted from the product boundary

Scale: xlarge

Complete gap #4 wholesale. chat-runtime.ts drops the pi mirror (verified: imports Agent from @mariozechner/pi-agent-core at line 1): baselines from state.readModels.fetch({ kind: "surfaceTranscript", target }); live display applies surface-stream-patch notifications in streamSequence order per surfacePiSessionId; stream gaps and slow-consumer closes discard local patches and call state.readModels.rebaseline({ workspaceId, reason: "event-sequence-gap", target, afterSequence }) instead of rpcClient.request.openSurface (verified at chat-runtime.ts:1384-1394). Remaining panes (sessions sidebar, agents, extensions, snippets, workflows, approvals, request-input, layout persistence) consume read models + DesktopRendererNotification and submit edits through stateCommands/runtime facades. Snapshot contracts are deleted from the product boundary in the same landings: ConversationSurfaceSnapshot, SurfaceSyncMessage snapshot payloads, openSurface/openSession snapshot returns, catalog sync emission, and the catalog's remaining legacy read/snapshot builders (session-catalog finishes its reduction to structured-session store owner / state-port router leaf). May land as 2-3 pane-group sub-landings (chat/transcript; sessions/layout; agents/extensions/snippets/workflows), each gate-green and each deleting its own legacy RPC methods and seam-test entries.

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:112-117 — 'Full surface snapshot pushes are not the steady-state notification model. DesktopRendererNotification must not carry full surface snapshots, and snapshot-oriented RPC contracts are not the @svvy/desktop public renderer API'
- docs/specs/package-architecture/desktop.spec.md:591-597 + 808-811 — 'const rebaseline = await state.readModels.rebaseline({ workspaceId, reason: "event-sequence-gap", target, afterSequence: lastAppliedSequence }) ... Surface stream gaps discard renderer-local stream patches for that surface and fetch a fresh SurfaceTranscriptReadModel'
- docs/specs/package-architecture/desktop.spec.md:781-786 — 'Desktop applies surface.stream patches in streamSequence order for each surfacePiSessionId; it must not use app-runtime sequence as the per-surface patch cursor'
- docs/specs/package-architecture/desktop.spec.md:101-107 — 'Renderer code must not import @mariozechner/pi-agent-core, @mariozechner/pi-ai ...' (violated today at src/mainview/chat-runtime.ts:1)
- docs/specs/package-architecture/desktop.spec.md:462-466 — 'Renderer Agents, Extensions, Settings, Approval, Snippets, Workflows, and layout surfaces consume state-backed read models and submit typed product commands through runtime/app command facades. The renderer-facing state facade is read-only'
- docs/specs/package-architecture/desktop.spec.md:599-603 — 'Full session, surface, transcript, command, settings, Agents, Extensions, Snippets, Workflows, approval, and request-input data is returned only by explicit state read-model facade fetch/rebaseline calls'
- docs/progress.md:33 — 'Feed static workspace panes from renderer-local non-authoritative warm read-model caches backed by @svvy/state read models'

Files:
- /Users/polarzero/code/projects/svvy/src/mainview/chat-runtime.ts (major rewrite: read-model view state + ordered patches; pi Agent mirror deleted)
- /Users/polarzero/code/projects/svvy/src/mainview/ conversation/transcript projections + pane stores + Svelte components (AgentsPane, ExtensionsPane, SnippetsPane, WorkflowsPane, Settings, SessionSidebar, RequestUserInputPanel, RuntimeApprovalPanel, pane-layout/workspace-tabs)
- /Users/polarzero/code/projects/svvy/src/shared/workspace-contract.ts (delete ConversationSurfaceSnapshot ~:1356, snapshot fields ~:496/:561/:1439/:1590, openSurface/openSession snapshot returns, migrated RPC methods)
- /Users/polarzero/code/projects/svvy/src/bun/index.ts (delete snapshot builders/sync fanout ~:982-998 and migrated handlers)
- /Users/polarzero/code/projects/svvy/src/bun/session-catalog.ts (delete emitSurfaceSync/buildSurfaceSnapshot and remaining renderer-feed builders)
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (reject pi imports under src/mainview/** and src/shared/**; reject snapshot DTO reintroduction)

Test strategy: Renderer unit tests: transcript view model from SurfaceTranscriptReadModel + ordered patch application per surfacePiSessionId; streamSequence gap → local patch discard + rebaseline through the state facade fake; stale-generation patch rejection; per-pane tests over fake bootstrap-provided facades; ChatRPCSchema contract test enumerating the remaining allowed methods (empty legacy set at completion); sequence-gap rebaseline rows (desktop.spec.md:892-894). e2e on the OrbStack lane: live prompt streaming, gap-injection rebaseline, multi-workspace tabs. Visual verification for transcript/composer/approvals (desktop.spec.md:902-903).

Landing criteria: All fast gates green; grep/boundary-level proof that ConversationSurfaceSnapshot and catalog sync emission are gone from product code (dev-gated inspection lanes exempted by exact allowlist if retained); no pi-native imports under src/mainview/** or src/shared/**; e2e streaming + rebaseline green; each sub-landing deletes its own legacy methods (no unpinned dual feed ever ships).

Risks:
- Largest renderer rework: 3625-line chat-runtime with an embedded pi-Agent mirror plus dependent Svelte stores — inventory every snapshot field consumed BEFORE starting; any transcript detail missing from read models blocks deletion and must be resolved as increment-6 follow-up kinds, never worked around
- Live-turn continuity across workspace tab switches must come from rebaseline + patch replay, not cached snapshots
- UI regressions need the visual-verification lane; schedule pane groups to keep each review tractable

## 11. Desktop spec Tests-section completion, boundary hardening, acceptance bookkeeping

Scale: medium

Close every remaining desktop.spec.md:873-903 Tests row not already landed inside increments 1-10, enumerated as a checklist mapped to named tests: RPC contract tests against fake bootstrap-provided renderer-safe facades (not fake ManagedRuntime); ManagedRuntime bridge tests (caller-owned facades, no ad hoc Effect runtimes, typed failure/defect mapping, cancellation propagation, clean failure after disposal); notification subscription disposal matrix (window close/workspace close/renderer unsubscribe); writeCommandStdin contract rows; sequence-gap rebaseline and stale-refetch rows; app shutdown coordinator matrix (typed shutdown rejection, terminal subscription close, shutdown receipts/app-log facts, dispose owned only by bootstrap); final boundary rows (renderer/shared pi-free, non-UI packages cannot import @svvy/desktop, ManagedRuntime.make allowlist final). Run heavy gates (build:check, OrbStack e2e, visual verification) as the integration's acceptance sweep. Update docs/progress.md: Current Baseline row :25-28, pane-cache row :33, and the 0A rows (:135-155, :218-224, :231-234, :290-300, :326-328, :383-388, :677-697, :806-815, :841-878) checked only with real landing commit hashes.

Spec citations:
- docs/specs/package-architecture/desktop.spec.md:875-881 — 'RPC contract tests against fake bootstrap-provided renderer-safe runtime/state facades, not a fake ManagedRuntime ... ManagedRuntime bridge tests proving RPC handlers use caller-owned facades, do not create ad hoc Effect runtimes, map typed failures/defects to stable renderer errors, propagate cancellation ... fail cleanly after runtime disposal'
- docs/specs/package-architecture/desktop.spec.md:885-898 — notification disposal, writeCommandStdin, sequence-gap/stale-refetch, and 'App shutdown coordinator tests proving ... ManagedRuntime.dispose() is owned only by bootstrap'
- docs/specs/package-architecture/desktop.spec.md:899-903 — 'Boundary tests proving renderer/shared contracts do not import pi-native message/session/model types and non-UI packages do not import @svvy/desktop. Browser/e2e tests through the supported OrbStack lane. Visual verification for high-risk panes'
- docs/progress.md:11-13 — 'Completed items must name the landing commit hash or hashes; leave an item unchecked until that commit exists'

Files:
- /Users/polarzero/code/projects/svvy/packages/desktop/src/desktop-app.test.ts + new packages/desktop contract/bridge test files
- /Users/polarzero/code/projects/svvy/src/bun/desktop-notification-bridge.test.ts + shutdown/bridge test files
- /Users/polarzero/code/projects/svvy/packages/package-boundaries.test.ts (final rows)
- /Users/polarzero/code/projects/svvy/docs/progress.md (acceptance rows with commit hashes)

Test strategy: This increment IS test work: map each desktop.spec.md:873-903 row to an existing test from increments 1-10 or write it here using fake facades/notification handles; run the full fast-gate set plus build:check, OrbStack e2e, and visual verification records for chat/approvals/settings before checking progress rows.

Landing criteria: Every Tests-section row maps to a named green test or a recorded e2e/visual verification; all fast gates green plus heavy gates; progress.md rows checked only where landing commits exist.

Risks:
- Rows discovered unsatisfied here mean an earlier increment under-delivered — treat as reopening that increment, not test-side patching; the highest-risk rows (cancellation propagation, post-disposal rejection, shutdown matrix) are deliberately written inside increments 3, 8, and 9 rather than deferred here

## Key Design Decisions

- Judge verdict: Plan A (risk-first) is the base — it is the only plan whose end state is reachable. The decisive fork is pi absorption: I verified in the repo that RuntimeSurfaceEventPublisher.publishStreamPatch has ZERO production callers, that the publisher is package-private with no bootstrap event-publication port (runtime.spec.md:3043-3046, 3087-3088; the wake port explicitly may not 'publish events', :523-525/:549), that the catalog's stream patches bypass the event bus entirely (session-catalog.ts:3517-3540 emits straight to the renderer sync listener), and that the Current Baseline acceptance row this integration discharges reads '@svvy/pi-adapter owned below runtime' (progress.md:25-28), backed by unchecked 0A rows 677-697 and 869-874 and runtime.spec.md:732-738/:4678-4690. Plans B and C both scoped pi absorption out, which leaves their renderer cutovers (B-I5/I9, C-I7/I9) emitting surface-stream-patch notifications with no spec-legal producer and the baseline row permanently uncheckable. Their 'the six gaps don't need it' argument fails because gap #4's steady state (DesktopRendererNotification derived from runtime events, desktop.spec.md:269-271) transitively requires runtime-published surface.stream.
- Grafts onto the Plan A skeleton: from Plans B/C, the workspace-store router lives in @svvy/state, not app/bootstrap — resolving Plan A's own openQuestion against it: progress.md:137-139 literally says '@svvy/state exposes one app-composed router/layer that dispatches to the correct app-global or workspace store' and runtime.spec.md:502-504 forbids app/bootstrap route resolvers. From Plan B: shared-store-instance discipline (bootstrap wires the exact StructuredSessionStateStore instances the catalog owns through the restricted @svvy/state/structured-session-adapters seam, state.spec.md:413-416 — no dual SQLite connections), seam-enumeration pinning tests for every transitional channel, and the shell-swap-before-renderer-migration ordering (contained diff; the biggest renderer rewrite then happens and is e2e'd under the final shell). From Plan C: DesktopBridgeErrorContractSchema hoisted to @svvy/core (matches the verified existing core pattern — StateStoredErrorSchema at packages/core/src/errors.ts:90-103 already uses the identical issues/cause fields — and desktop.spec.md:812-813 'hoisted @svvy/core schemas' + :843-845 effect-import ban make src/bun placement inferior), the explicit bootstrap lifecycle coordinator content (folded into increment 3), and the Electrobun rpc-at-construction risk on the host adapter.
- Factual correction applied against Plan A: SurfaceTranscriptReadModel and CommandInspectorReadModel ARE fully spec'd (verified at state.spec.md:3134-3159 and :3161-3190, exactly as Plan C claimed) — Plan A's 'shape is named but not fully specified anywhere' is wrong. This shrinks increment 6's genuine spec-authorship burden to the remaining kinds (sessionNavigation request/result, surface slices, requestInput, approvals, agents, extensions, snippets, workflowsGenerated, inspectors, workspace chrome/layout/panel-binding) and shrinks openQuestion 1 accordingly.
- Session-catalog decomposition map (the hardest coupling, merged from A and C): the 8138-line catalog splits into three roles retired on different increments — (a) runtime-facing state-port provision moves to the @svvy/state workspace-store router over the SAME store instances (increment 1); (b) pi-session/prompt/dispatch execution moves into runtime-owned surface scopes with PiAdapter added to Runtime.layer (increment 4), at which point the wake/prompt-control host-port delegation into the catalog dies; (c) legacy read/snapshot builders port into @svvy/state read-model builders with golden parity fixtures (increment 6) and are deleted with the snapshot RPC removal (increment 10). What survives: the structured-session store owner / state-port router leaf. WorkspaceRuntimeRegistry is reduced, not deleted — an app-edge opened-workspace host registry, explicitly permitted factoring per desktop.spec.md:134-137; runtime-service-adapter shrinks to one-shot composition glue inside app-runtime-bootstrap.
- Sequencing is risk-first with a mandated contract step: increments 1-2 are the validation/contract harness immediately before the production cutover (progress.md:17-20), increments 3-4 retire the two riskiest couplings (per-workspace runtimes, then catalog prompt ownership) before any renderer or desktop-package work, making increments 5-11 largely mechanical. Interim states are legal and pinned: between increments 3 and 4 the catalog still executes prompts behind the spec-named RuntimeLayerSurfaceQueueWakePort/RuntimeLayerPromptControlHostPort bootstrap primitives (the approved app-edge port list, runtime.spec.md:516-521); between increments 4 and 10 the renderer is fed by an app-edge adaptation of runtime stream events into the existing sync channel (single producer preserved). Every transitional channel is enumerated by a seam test naming its retirement increment, and every replacement deletes its predecessor in the same landing — no unpinned dual path ever ships.
- Renderer cutover is strictly gated on its two suppliers: runtime-published surface.stream/surface.changed (increment 4 — first production callers of RuntimeSurfaceEventPublisher) and the expanded read-model kinds (increment 6 — the union is verified closed at five kinds today, state.spec.md:553-565/:614-616, and StateCommands is verified to implement only appLogs/appPreferences/providerAuth). The notification bridge (increment 8) encodes the two-cursor split (app-runtime sequence for subscriptions/refetch, streamSequence per surface, desktop.spec.md:781-786) before any renderer store migrates.
- createDesktopApp adoption (increment 9) lands after the notification bridge but BEFORE the renderer data-flow migration: the bridge adapter legally carries remaining legacy RPC handlers as app/bootstrap-owned handlers over injected facades (app/bootstrap owns bridge wiring either way), each pinned by an enumerating contract test and deleted pane-by-pane inside increment 10's sub-landings. This keeps the shell swap a contained diff and gives packages/desktop its product call site two increments earlier than Plan A's ordering.
- Spec/ledger co-landing discipline: state.spec.md union rows, the state restricted-subpath ledger, the @svvy/core public-symbol index (check:core-index), the runtime bootstrap export ledger, and packages/package-boundaries.test.ts exact allowlists are edited in the same landing as the exports they pin — never leaving spec and code divergent across a landing. Every increment lands with the full fast-gate set green (check:core-index, typecheck, lint:check, format:check, test:effect, test:unit incl. the 10.5k-line exact-allowlist boundary test); xlarge increments may split into sub-landings only if each is gate-green and pins its seam.
- Concurrent-work hedge: the plan treats the in-flight sandbox fix as landed input — increments 2-4 compose createRuntimeServiceAdapter only through its post-fix shape (explicit sandbox host-support injection); no increment builds on the old adapter-internal createPackagedSandboxHostSupportServices() call, and increment 2 rebases against the final shape before landing.
- Data topology: per-workspace structured-session SQLite files and the per-cwd app-log DBs are RETAINED and routed (progress.md:137-139 says 'the correct app-global or workspace store', plural; the shipped bootstrap app-log facade rows are already checked DONE at dab04ac, progress.md:361-378) — no data migration is planned anywhere in this integration; consolidation to one DB, if ever intended, is a separate owner decision (openQuestion 2).

## Open Questions (owner input needed)

- Request/result shapes for most renderer read-model kinds are genuinely unauthored: state.spec.md:614-616 closes the union ('Additional read-model kinds are not package-root facade contracts unless this spec names their request/result variants, builders, invalidation mappings, root exports, and tests'), and only surfaceTranscript (:3134-3159) and commandInspector (:3161-3190) have authored shapes, while progress.md:221-224 and desktop.spec.md:462-466/:720-724 demand ~15 kinds including sessionNavigation, surface slices, requestInput, approvals, agents, extensions, snippets, workflowsGenerated, handler/task-attempt inspectors, and the workspace layout/panel-binding kind that panel-binding validation requires. Increment 6 authors them into state.spec.md (the sanctioned mechanism), but the exact contract shapes need owner sign-off before implementation — this is spec authorship, not derivable from existing text.
- Workspace-store entry mechanism into the @svvy/state graph is underdetermined: StateLayerConfig carries exactly one databasePath (state.spec.md:421-430) and state.spec.md:386-391 speaks of 'the same acquired state graph and database handle' (singular), while progress.md:137-139 requires the state router to dispatch 'to the correct app-global or workspace store' (plural). No spec states HOW per-workspace stores/paths enter the state composition (restricted structured-session-adapters symbol extension? layer-config extension? a state-owned acquisition service over committed workspace cwd facts?), nor whether the eventual steady state consolidates into one app DB. Increments 1-3 conservatively route the existing per-workspace stores through the restricted adapters seam with a state-spec ledger extension; the exact allowed-symbol set, and any future single-DB consolidation (which would require inserting a data-migration increment), are owner decisions.
- appPreferences/settings source of truth: StateCommands.appPreferences and the settings/appPreferences read models are state-DB-backed (state.spec.md:553-576), but the shipped app persists these preferences in the file-backed agent-settings-store (src/bun/agent-settings-store.ts, consumed throughout workspace-runtime-registry.ts). No spec line defines the migration/adapter path from the file store to state-owned rows; increment 5 needs an owner call between a one-time import at first bootstrap versus demoting the file store to a bootstrap-only seed input.
