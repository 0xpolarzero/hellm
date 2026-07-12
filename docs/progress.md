# Progress

Incremental roadmap toward the shipped PRD.

How to use this file:

- Keep items small enough to land in a focused PR.
- Treat this file as a roadmap and progress tracker.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
- Keep sections ordered by dependency: durable facts and execution before projection surfaces that depend on them.
- When an item is done, change `[ ]` to `[x]` and append the landing commit hash or hashes.
- Completed items must name the landing commit hash or hashes; leave an item unchecked until that
  commit exists.
- Write each item as the steady-state capability.
- When the resolved design changes, rewrite affected items to the current steady-state plan.
- If an item starts reading like a subsystem instead of a step, split it before implementation.
- For any big lift or unclear design, add a focused contract or validation step immediately before
  the production implementation step.
- Use validation steps to settle shape, constraints, and UX while keeping items written as
  steady-state capabilities.

## Current Baseline

- [x] Bootstrap the Electrobun desktop app shell. Commit(s): `c118be7`
- [ ] Run the Electrobun desktop shell as `@svvy/desktop` only through app/bootstrap-injected
      renderer-safe runtime and state read/command facades over the single healthy app-owned
      `ManagedRuntime`, with app-bootstrap runtime event subscription/fanout to renderer-safe
      notifications, renderer rebaseline handling, and `@svvy/pi-adapter` owned below runtime.
- [x] Add provider auth/settings support with local key storage and OAuth-backed access. Commit(s): `c118be7`, `6d757dc`
- [x] Add the artifact projection panel in the desktop workbench. Commit(s): `1d9bc05`, `6d757dc`
- [x] Add workspace-scoped prompt history recall in the composer. Commit(s): `cb1b7f1`
- [x] Add multi-session workspace navigation and session switching/resume support. Commit(s): `b22a0c6`, `df1a7df`
- [ ] Feed static workspace panes from renderer-local non-authoritative warm read-model caches backed by `@svvy/state` read models, with app-global state shared across workspace tabs, workspace projections keyed by workspace id, background refresh at runtime boundaries, and immediate pane updates after read-model invalidations or rebaseline results.

## 0A. Effect Package Architecture

- [ ] The shared `@svvy/core` package contract contains branded ids, Effect Schema contracts,
      tagged domain errors, typed runtime notification and stream-event contract shapes, command
      envelopes, declarative `RuntimeEffectRequest` schemas, schema-backed generated-package
      fact/metadata contracts, and cross-package port data contracts.
  - [ ] Schema-backed boundary ledgers cover runtime-facing state ports, extension
        registry/binding/native-tool DTOs, generated-package refresh facts, workspace-link plans,
        workflow task-agent bridge payloads, command facts, recovery payloads, and artifact inputs,
        with accepted/rejected JSON examples and facade error mappings for each exported method.
    - [ ] Define exact contracts for the P0 runtime-facing state-port DTOs used by queue
          lifecycle, approval requests, and session wait projection, including durable record
          shapes, transition inputs, owner/lease fields, and after-commit invalidation behavior.
    - [ ] Define exact contracts for runtime-facing handler episode records, handler-thread
          read models, recovery work rows/payloads/leases, extension state ports, and public
          `@svvy/extensions` registry/binding/native-tool service DTOs, including explicit
          app-versus-workspace recovery scope and no omitted-target thread episode reads.
    - [ ] Generated-agent-context DTOs live in `@svvy/core`: `BuildGeneratedContextInput`,
          `GeneratedContext`, `GeneratedContextPromptBlock`, generated-context preview/binding
          read-model payloads, fingerprints, diagnostics, token estimates, and boundary decoders are
          schema-backed core contracts consumed by `@svvy/extensions`, `@svvy/runtime`,
          `@svvy/state`, app/bootstrap, bridge code, and renderer/shared code. Duplicated shared
          UI/Bun DTO declarations are absent except package-private view models derived from core or
          state read-model contracts.
    - [ ] Desktop renderer bridge DTOs live in core/state/runtime public contracts or
          `@svvy/desktop` renderer-safe adapter types: renderer transcript, stream patch, context
          usage, model display, tool-call projection, and `ChatRPCSchema` lifecycle/read-model
          receipts use those desktop-facing contracts, while full surface snapshots and pi-native
          messages are absent from the renderer bridge boundary.
    - [ ] The package architecture contract uses the exact Effect v4 beta.84 surface for schema
          decoders/assertions, schema representation imports, explicit non-adoption of Effect SQL,
          core-owned data-only port tags, extension source-edit method ledgers, builtin source
          materialization results, and extension-facing state-port read/evidence-return authority.
- [ ] The non-UI package graph exists as Effect v4 service/layer packages with scoped resources,
      typed errors, streams, schedules, queues, subprocess boundaries, and `@effect/vitest` test
      layers.
  - [ ] Keep the installed Effect stack exact and coherent across manifests, `bun.lock`, local
        references, package-boundary checks, and `SVVY-EFFECT-001`; every adopted `effect`,
        `@effect/platform-*`, and `@effect/vitest` package resolves as one compatible version set
        before product code imports the API surface. Effect SQL is outside the current package
        architecture. Root devDependencies own `vitest` and `@effect/vitest`, while package-local
        devDependencies remain forbidden.
  - [ ] The package graph is available in dependency order: `@svvy/core` contracts,
        `@svvy/state` layers/facades and state-backed port layers, `@svvy/extensions`,
        `@svvy/sandbox`, `@svvy/pi-adapter`, `@svvy/runtime`, and `@svvy/desktop`
        facade-only consumption. Each package exposes only its spec-owned Effect service/layer
        boundary and package-boundary tests cover the public surface before dependent packages
        consume it.
    - [ ] `layerRuntimeBunPlatform` provides the adopted Bun/Electrobun abstract platform subset:
          `FileSystem.FileSystem`, `Path.Path`, and `Crypto.Crypto` through
          `BunFileSystem.layer`, `BunPath.layer`, and installed-verified `BunCrypto.layer`;
          package-boundary tests keep every other Bun platform module out of product code.
    - [ ] `SVVY-EFFECT-001` enforces the installed Effect stack before typecheck/build: every
          referenced Effect API either typechecks in covered source against the installed package
          set or has a dated installed-export audit row, and local reference snapshots never bypass
          the manifest/lockfile source of truth.
  - [ ] Data-only core-owned port tags use the Effect v4 function-syntax
        `Context.Service<PortIdentifier, PortService>("@svvy/core/...")` pattern, preserve root
        export names, and keep Effect environment requirements type-distinct from structural
        `*Service` implementation shapes.
    - [ ] `ExtensionStatePort` uses function-syntax
          `Context.Service<ExtensionStatePort, ExtensionStatePortService>`, generated-package
          refresh requirements use `ExtensionStatePort` as the Effect environment type, and
          providers implement the `ExtensionStatePortService` shape.
    - [ ] `AppLogWritePort` uses function-syntax
          `Context.Service<AppLogWritePort, AppLogWritePortService>` and the state-owned provider
          returns the `AppLogWritePortService` shape before installing it through the core-owned
          tag.
    - [ ] `SandboxPolicySource` uses function-syntax
          `Context.Service<SandboxPolicySource, SandboxPolicySourceService>`, the state-owned
          provider returns the `SandboxPolicySourceService` shape, `@svvy/sandbox` consumes that
          shape only after yielding the core-owned tag from its layer, and `layerSandboxPolicySource`
          is the zero-argument `StructuredSessionState` projection layer named by the state spec.
    - [ ] `ProviderAuthPort`, `SecretStorePort`, and `PiRuntimePathsPort` use function-syntax
          `Context.Service<PortIdentifier, PortService>` tags while callers and tests keep
          providing plain `*Service` objects through the core-owned dependency identities.
    - [ ] `PiSessionReferencePort` uses function-syntax
          `Context.Service<PiSessionReferencePort, PiSessionReferencePortService>` and callers/tests
          keep providing plain `PiSessionReferencePortService` objects through the core-owned
          dependency identity.
    - [ ] Runtime state ports use function-syntax
          `Context.Service<PortIdentifier, PortService>` tags for queue, turn, command, approval,
          wait, artifact, request-input, generated-package, actor-extension-binding,
          extension-context-impact, recovery, episode, thread, and read-model state dependencies;
          `@svvy/state` providers return the matching plain `*Service` shapes and install them
          through the core-owned tags.
    - [ ] Package-local data-only host/config ports use the same function-syntax
          `Context.Service<PortIdentifier, PortService>` shape only where the owning package spec
          and boundary tests name the port: `ExtensionSourceRootsPort`, `GeneratedPackageRootPort`,
          `WorkspaceSourceLinkPort`, `SandboxHelperCandidatesPort`, and `HostProcessReferencePort`.
  - [ ] Package architecture specs state the Effect v4 composition invariants: state
        read/command services are Effect-native, state command facades run over the app-owned
        `ManagedRuntime` context supplied by app/bootstrap and containing `StateCommands` and the core-owned
        `StateCommandPostCommitNotificationPort`, runtime services own post-commit notification
        handling, named state port layers project from one acquired state layer,
        `@svvy/pi-adapter` owns pi session and turn adaptation without creating or receiving a
        package-owned `ManagedRuntime`, and app/bootstrap composes the package graph once, owns the
        single app `ManagedRuntime`, and injects renderer-safe facades into `@svvy/desktop` through
        the `createDesktopApp(...)` adapter contract.
    - [ ] Core-owned runtime-facing source, recovery, extension-dependency, generated-package link,
          queue, command, request, approval, turn, and thread state-port contracts carry explicit
          app/workspace routing identity or globally resolvable committed records, and `@svvy/state`
          exposes one app-composed router/layer that dispatches to the correct app-global or
          workspace store without deriving invalidations from a bound single-workspace store.
          Workspace acquisition is routed through the single app-owned `ManagedRuntime` and
          package-private runtime scope services, never per-workspace catalog-backed `ManagedRuntime`
          adapters.
    - [ ] App bootstrap owns exactly one composed app `ManagedRuntime` for healthy desktop/headless
          operation; workspace registries, opened-workspace records, browser tools, and desktop
          adapters route through workspace-keyed facades over that runtime and do not create
          per-workspace runtimes, store runtime facades as workspace state, or provide runtime-owned
          time/source/queue semantics from app-edge callback objects.
      - [ ] App/bootstrap exposes renderer, browser-tool, and headless facades only after
            `managedRuntime.context()` and runtime startup readiness succeed, exposes no live
            facades during failed startup or runtime handoff, and disposes the retired app runtime
            before exposing the successor runtime.
      - [ ] App/bootstrap owns the complete runtime lifecycle coordinator: it rejects new bridge
            calls during shutdown, closes facade subscription/callback scopes, runs runtime shutdown
            preparation/drain, records shutdown receipts/app-log facts, disposes the retired
            `ManagedRuntime`, and only then exposes any successor runtime.
    - [ ] `@svvy/state` exposes one decoded-config `layer({ config, digest? })`, `StateReadModels`,
          `StateCommands`, approved facade factories, and named core-owned port layers from a
          single acquired state layer. Structured-session stores, `*FromStore` helpers,
          SQL/repository helpers, migrations, and restricted structured-session wiring subpaths are
          app-bootstrap/state-test-only surfaces; package-boundary tests prove runtime, desktop,
          browser-tool, headless consumers, and non-bootstrap app code use only public facades or
          core-owned ports.
      - [ ] App/bootstrap reads `SVVY_STATE_DATABASE_PATH`, `SVVY_STATE_ARTIFACT_ROOT`, and
            `SVVY_STATE_BUSY_TIMEOUT_MS`, validates them into `StateLayerConfig`, maps config-source
            and schema failures into `StateContractError` before state acquisition, and passes the
            decoded config to `@svvy/state.layer({ config, digest? })`; `@svvy/state` exposes config
            schemas/contracts but does not read ambient env.
      - [ ] State-owned timestamp creation, deadline math, retention cutoffs, leases, retry times,
            and app-log timestamps use Effect `Clock`/`DateTime` through the acquired state layer or
            explicit runtime-provided timestamp inputs; production state code does not call
            `Date.now()`, `new Date()`, unsafe DateTime/Clock helpers, or app-edge injected `now()`
            callbacks.
      - [ ] The configured `busyTimeoutMs` is applied to every SQLite connection opened by
            `@svvy/state`, including setup, migration, repository/read-model, maintenance, and
            test-layer temp-file connections, and the timeout is verified before exposing state
            services.
      - [ ] `@svvy/state.layer({ config, digest? })` acquires the single app state layer and
            provides the exact public root output set named by the state spec: `StateReadModels`,
            `StateCommands`, and approved core-owned state-backed ports. Restricted structured
            session wiring remains available only through the state-owned subpaths and exact
            consumers named by the state spec and package-boundary tests. Core-owned state-backed
            ports such as `ExtensionStatePort`, `SandboxPolicySource`, app-log ports,
            pi-session reference ports, and runtime-facing state ports are exposed through named
            zero-argument projection layers over that acquired state layer, not by opening or
            configuring independent stores. Its required environment is exactly the abstract
            platform services named by the spec, `FileSystem.FileSystem` and `Path.Path`; secret
            mutation is supplied only to the named secret-write command/facade paths through
            `SecretStoreMutationPort`, and sync digest paths consume only the narrow optional
            `StateDigestHelper` supplied through layer input, with no broad crypto, secret adapter,
            live secret-read port, or config object smuggled through layer input.
      - [ ] State-backed port layers such as `layerRuntimeQueueStatePort`,
            `layerExtensionStatePort`, `layerSandboxPolicySource`,
            `layerProviderAuthStatusStatePort`, `layerPiSessionReferencePort`, and
            `layerAppLogWritePort` are zero-argument Effect layers that require only the shared
            `StructuredSessionState` service, construct plain `*Service` provider objects, and
            install them through the core-owned `Context.Service` tags. App/bootstrap composes every
            named port layer over the same acquired state layer, and package-boundary tests reject
            any named port layer that opens, configures, or owns its own store.
    - [ ] `@svvy/state` public exports match the state spec exactly: the package root exposes the
          specified state layer, named state-backed port layers, approved read/command facade
          factories, `StateReadModels`, `StateCommands`, and facade error/contracts; the
          `@svvy/state/structured-session-state` and
          `@svvy/state/structured-session-adapters` subpaths expose only the restricted
          bootstrap/test structured-session wiring surfaces named by the state spec and
          package-boundary tests. Broad stores, repositories, transactions, SQL clients,
          migrations, table helpers, generic mutation surfaces, and non-allowlisted
          implementation adapters remain private.
      - [ ] Restricted `@svvy/state/structured-session-state` and
            `@svvy/state/structured-session-adapters` export ledgers name every allowed symbol,
            allow production consumption only from app/bootstrap, allow tests only from
            `@svvy/state` tests and approved app/bootstrap integration fixtures, and reject runtime,
            desktop, renderer/shared, extensions, pi-adapter, sandbox, browser-tool, headless, and
            generated-package consumers.
      - [ ] App bootstrap owns structured-session adapter/store wiring through one approved
            composition boundary; package-boundary tests reject direct pi-native package,
            structured-session store, or `*FromStore` adapter factory imports outside approved
            bootstrap and state-test surfaces.
      - [ ] `StateCommands` exposes the full command facade groups from the state spec:
            `workspaceChrome`, `workspaceLayout`, `appPreferences`, `agentProfiles`, `snippets`,
            `providerAuth`, `extensionEnv`, and `appLogs`.
      - [ ] `StateReadModels` supports every `StateReadModelRequest.kind` in the state spec,
            including workspace, session navigation, surface, transcript, command inspector,
            handler inspector, request input, approvals, agents, extensions, settings, provider
            auth, app preferences, snippets, workflows generated, app logs, and app log summary.
      - [ ] `@svvy/state` consumes the core-owned `SecretStoreMutationPort` only for secret env
            writes/removals.
      - [ ] `layerPiSessionReferencePort` is a zero-argument Effect layer that requires the shared
            `StructuredSessionState` service, provides the core-owned `PiSessionReferencePort` tag,
            maps persistence failures to `PiSessionReferencePortError`, and is covered by focused
            state tests.
    - [ ] App/bootstrap exposes only renderer-safe desktop notifications derived from runtime
          events. Renderer bridges receive read-model invalidations, rebaseline requests, renderer
          commands, and shutdown notices; raw `RuntimeEvent` values stay below the bootstrap
          fanout boundary.
  - [ ] Package-boundary checks cover exact public subpath exports, allowed Effect module imports
        per package, `@effect/vitest` service-test lanes and root dependency placement, no
        pi-native leaks from public, renderer, desktop, app-entry, browser-tool, headless, or shared
        contract surfaces outside `@svvy/pi-adapter`, no unledgered pi-adapter session exports, no
        pi-native leakage outside the root service, `@svvy/pi-adapter/messages`, and the restricted
        `@svvy/pi-adapter/session` bootstrap subpath named by package-boundary tests, no public
        boundary error/schema codec gaps, no
        `Schema.optional(...)` public optional fields without explicit undefined-valued exceptions,
        no generated `@svvyx/workflows`/`@svvyx/extensions` manifest or import-policy drift,
        production `ManagedRuntime.make` limited to app/bootstrap, production `Effect.run*` limited
        to the exact app/bootstrap, process-entrypoint, facade/bridge, pi-adapter callback bridge,
        and source-invalidation coordinator adapter allowlists named by package-boundary checks, and
        test runtime construction limited to named harness files.
  - [ ] Boundary tests reject renderer-root runtime internals: `packages/desktop/src/**`,
        `src/mainview/**`, and `src/shared/**` cannot import pi-native packages, `@svvy/pi-adapter`,
        `@svvy/extensions`, `@svvy/state/*` implementation subpaths, raw runtime internals, or
        pi-shaped message/session/model DTOs; desktop receives only prebuilt renderer-safe facades.
  - [ ] Boundary tests enforce Effect ownership: Effect runtime/module member adoption is scoped
        by owner package or allowed file, Effect package versions match the lockfile, root owns
        `vitest` and `@effect/vitest`, and package manifests do not own package-local Effect test
        dependencies.
  - [ ] Boundary tests enforce the `@effect/vitest` lane shape: reject `it.live(...)`,
        `it.effect.prop(...)`, `Schema.toArbitrary`, `effect/testing/FastCheck`, unledgered
        `TestClock.withLive(...)`, unapproved `layer(...)` / `it.layer(...)` option keys,
        `flakyTest`, unledgered fork option objects, unledgered `Effect.provide(..., { local:
true })`, and broad sleep/polling helpers in unit tests.
  - [ ] Boundary tests reject ambient `process.env`, Bun env, and host env reads from runtime,
        state, extensions, sandbox, pi-adapter, desktop, renderer, and generated packages except
        exact app-edge config readers named by package specs.
  - [ ] Boundary tests enforce `@svvy/runtime` exports: the root exports only
        `Runtime`, `Runtime.layer`, `layer`, and `createRuntimeFacade(...)`; the approved
        `@svvy/runtime/prompt-execution-context` subpath exposes only prompt-execution context
        construction helpers named by the runtime spec; the approved
        `@svvy/runtime/accepted-native-tool-execution` and
        `@svvy/runtime/source-invalidation-coordinator-adapter` subpaths expose only their
        app-bootstrap Promise adapter symbols named by the runtime spec; the bootstrap subpath
        exports only approved app-composition primitives named by the runtime spec, including
        config/readiness/shutdown helpers, the Bun platform layer, primitive prompt cancellation,
        surface queue wake, command stdin/control, provider-auth/model lookup,
        generated-context refresh, generated-package refresh, and source-invalidation scan host
        ports, and does not expose wait-registry, event-bus, facade-adapter, accepted-tool,
        semantic source-coordinator, queue-dispatcher, generated-package repair, or runtime-effect
        internals.
  - [ ] Boundary tests enforce `@svvy/state` exports: root and public subpaths expose only the
        approved state layer, state-backed port layers, read/command facades, `StateReadModels`,
        `StateCommands`, facade contracts, renderer-safe `@svvy/state/session-navigation`,
        restricted `@svvy/state/generated-package-maintenance`, and the restricted
        `@svvy/state/structured-session-state` and
        `@svvy/state/structured-session-adapters` wiring subpaths named by the state spec; stores,
        repositories, SQL clients, migrations, table helpers, generic mutation surfaces, and
        non-allowlisted implementation adapters remain private or state-test-only.
  - [ ] Boundary tests enforce `LayerMap` candidate-only status: production code does not import
        or expose `LayerMap`; keyed workspace/surface scope ownership is implemented by
        package-private runtime-owned Effect services, and `LayerMap` is not a production API unless
        a package spec and manifest explicitly adopt it.
  - [ ] Desktop boundary tests prove prompt submission carries only runtime target, one new
        message, delivery intent, and telemetry/client-submission metadata; snapshots, pi message
        arrays, system prompts, tool declarations, generated-context payloads, and panel-focus
        routing are rejected before runtime submission.
  - [ ] Workspace-scoped desktop and headless calls route through one app-owned runtime facade
        keyed by `workspaceId`; opened-workspace registry records store only workspace identity,
        layout metadata, and state read-model routing metadata, and never store runtime facades,
        construct `ManagedRuntime`, or own runtime operations. Package-boundary checks allow
        production `ManagedRuntime.make(...)` only at the app bootstrap owner and allow test
        `ManagedRuntime.make(...)` only in exact facade/bootstrap/integration harness globs named by
        package-boundary checks.
  - [ ] Package-boundary tests reject app/bootstrap source-relative imports into package
        internals: `src/bun/**`, browser-tool bridges, headless entrypoints, and desktop bridge
        files import `@svvy/runtime` only through the package root, `@svvy/runtime/bootstrap`,
        `@svvy/runtime/prompt-execution-context`, `@svvy/runtime/accepted-native-tool-execution`,
        and `@svvy/runtime/source-invalidation-coordinator-adapter`. They do not import
        `packages/runtime/src/**` or
        relative paths resolving to runtime wait services, queue dispatchers, source-invalidation
        coordinators, generated-package refresh or repair internals, runtime scope services, event
        buses, runtime-effect appliers, accepted-tool helpers, prompt-execution helpers, or internal
        service constructors.
  - [ ] Boundary tests enforce Effect v4 secret/redaction boundaries: raw secrets enter only through
        named secret-intake schemas or host secret-store writes, convert to `Redacted` or secret
        references at trusted boundaries, and never serialize across persistence, RPC, runtime
        events, app logs, artifacts, generated packages, or model-facing prompt output.
  - [ ] Boundary tests enforce Effect observability adoption: package code cannot import
        `Effect.log*`, `Logger`, `Tracer`, `Metric`, or `Console` for product observability until
        exact manifest rows, owner specs, redacted structured payload schemas, and focused tests
        exist.
  - [ ] Bridge facade tests prove cancellation semantics: `AbortSignal` cancellation either
        interrupts the underlying fiber/resource scope or is explicitly wait-only for a named
        facade path; Promise-race cancellation is rejected except the named runtime facade bridge,
        and every exception has focused tests.
  - [ ] `AsyncIterable` and stream bridge tests prove cleanup on natural completion, early return,
        thrown iteration error, explicit close, window/workspace close, runtime restart, and app
        shutdown, with typed failure mapping before async iteration exposes events.
  - [ ] App/bootstrap owns an idempotent shutdown coordinator that rejects new bridge calls, closes
        facade subscription/callback scopes, requests bounded runtime drain/terminalization, records
        shutdown receipts/app-log facts, and then calls `managedRuntime.dispose()`.
  - [ ] Per-package positive proof tests cover the Effect spec verification matrix: core boundary
        issue paths and annotation allowlists, state nested transactions/reopen persistence/paged
        replay, sandbox scoped temp profile cleanup and no subprocess ownership, pi protocol drain
        and system-prompt isolation, extensions no desktop/runtime mutation, runtime helper-process
        reconciliation and slow-subscriber policy, desktop subscription-scope closure, and generated
        `@svvyx/*` negative boundary tests.
  - [ ] Public package entrypoints and package-boundary coverage exist for `@svvy/core`,
        `@svvy/state`, `@svvy/pi-adapter`, `@svvy/sandbox`, `@svvy/extensions`, `@svvy/runtime`, and
        `@svvy/desktop`, with each package exposing only the root/subpath surface named by its
        package spec.
    - [ ] The generated `@svvy/core` public-symbol index is regenerated from source contracts and
          checked by package-boundary tests so public ids, schemas, errors, ports, runtime events,
          read models, and DTO exports cannot drift from package specs.
  - [ ] `@svvy/state` exposes `layer({ config, digest? })`, root-layer config contracts, approved
        read facades, command facades, `StateReadModels`, `StateCommands`,
        `createStateCommandsFacade(...)`, and named state-backed port projection layers that provide
        core-owned state port service tags; repositories, SQL clients, SQLite handles, migrations,
        transaction helpers, table helpers, structured store classes, and broad mutation surfaces
        stay package-private or test-only.
    - [ ] SQLite persistence remains package-private to `@svvy/state`: repositories, setup,
          migrations, SQL clients, SQLite handles, transaction helpers, and table helpers do not
          cross the package boundary. Effect SQL is outside the current state-package architecture.
    - [ ] `@svvy/state` provides a state-owned `SandboxPolicySourceService` implementation and
          `layerSandboxPolicySource` projection layer that returns immutable core sandbox policy
          snapshots for workspace launches, app-generated package builds, workspace
          generated-package link repair, and extension dependency policy entries from explicit
          state-owned workspace, settings, and sandbox-policy facts; `@svvy/sandbox` consumes only the core-owned
          `SandboxPolicySource` tag through its own root layer.
    - [ ] Structured store classes and DTOs, broad structured-state mutation surfaces, raw
          repository/store helpers, and broad state subpaths are package-private or test-only;
          public consumers use only `layer({ config, digest? })`, approved read facades, command
          facades, and core-owned port layers.
    - [x] Expose a state-owned `AppLogWritePort` layer that validates the core append schema,
          persists redacted app-log rows through `@svvy/state`, preserves the supplied occurrence
          timestamp, maps related product ids, and returns committed app-log invalidation
          descriptors. Commit(s): `dab04ac`.
    - [x] `@svvy/state` exposes app-log read models and command facades through the approved state
          read/command facade factories, `StateReadModels`, `StateCommands`, and
          `createStateCommandsFacade(managedRuntime)`, with typed facade failures,
          core-schema validation for app-log read commands, idempotent command receipts, and
          committed `appLogs` invalidations. Commit(s): `dab04ac`.
    - [ ] State facade calls pass post-admission abort signals into the app-owned
          `ManagedRuntime` supplied by app/bootstrap so underlying fibers interrupt and release
          resources; pre-aborted calls fail as `reason: "aborted"` and interrupted exits map to
          `reason: "interrupted"`.
    - [x] Keep production app-log persistence access behind `AppLogWritePort`,
          `StateReadModels`, `StateCommandsFacade.appLogs`, and the state-owned
          `createStateAppLogsFacade(...)` app/bootstrap facade; root exports do not expose
          `AppLogFacade`, `AppLogger`, app-log stores, or standalone app-log implementation
          helpers. Commit(s): `dab04ac`.
      - [x] `@svvy/state` root does not export app-log logger helpers or standalone redaction
            helpers; app/bootstrap host-adapter code owns its app-local logger and
            execute-typescript output redaction while state keeps persistence redaction private.
            Commit(s): `dab04ac`.
    - [ ] `createStateCommandsFacade(managedRuntime)` covers every product state command
          group with idempotent command receipts and committed `afterCommit` descriptor collection;
          the facade runs over the app-owned `ManagedRuntime` context supplied by app/bootstrap and
          containing `StateCommands` and the runtime-provided `StateCommandPostCommitNotificationPort`, hands
          committed descriptors to that port, and public facade results expose only committed output
          plus receipts.
    - [ ] Ensure every runtime-facing state mutation returns a complete `StateMutationResult`
          descriptor set for the read models it changes, including command inspectors, handler
          thread inspectors, workflow task attempt inspectors, request-input inspectors,
          generated-package/readiness views, workspace chrome/layout, app settings, and app logs.
      - [x] Route the remaining catalog-owned session, surface-metadata, composer, queue-edit,
            title, and interrupted-recovery writes through the restricted state-owned mutation
            adapter, publish its exact committed descriptors through the runtime-owned adapter,
            and retain unaccepted batches for retry or consumer rebaseline without reporting the
            durable write as rolled back. Commit(s): `a55a5655a4`.
      - [ ] Generated-package build, failure, refresh-needed, manifest reconciliation, and
            workspace-link status writes return app read-model invalidations for
            `workflowsGenerated` or `extensions` from the committed state-port result.
  - [ ] Expose `Sandbox` plus the root `@svvy/sandbox` `layer` for immutable policy snapshots,
        helper lookup, launch constraints, and denial classification.
    - [ ] Align core sandbox launch scope/kind schemas with the sandbox spec, including
          generated-package workspace-link repair, and make sandbox launch policy build only from
          immutable state-resolved policy snapshots plus typed host-support ports.
    - [ ] Acquire `SandboxPolicySource`, `SandboxHelperCandidatesPort`, and
          `HostProcessReferencePort` through the root `layer` export from `@svvy/sandbox` so
          `Sandbox.buildLaunchPolicy` runs from the service's layer-owned dependencies and public
          sandbox methods require only `Sandbox`.
    - [ ] Expose the public `@svvy/sandbox` root only through the `Sandbox` service, root layer, and
          sandbox-owned service contracts; helper-specific launch builders are sandbox-internal or
          test fixtures, helper path/argv construction is package-private implementation detail
          returned only inside scoped launch facts, direct subprocess denial diagnostics live only on
          the exact restricted app-edge diagnostics subpath named by the sandbox spec, and
          core-owned sandbox launch facts remain the public runtime launch receipt returned by
          `Sandbox.buildLaunchPolicy(...)`.
    - [ ] Package-boundary tests enforce the `@svvy/sandbox` root allowlist, the exact
          restricted sandbox diagnostics surface, the package-private runtime launch-policy adapter,
          and the app-edge host-support composition boundary; filesystem policy builders, direct
          launch builders, helper argv/path builders, helper bootstrap classifiers, helper-specific
          launch builders, and denial internals stay off the package root and cannot be used by
          app-owned code to synthesize launch policy.
    - [ ] Enforce Bun app-edge sandbox import restrictions from
          `docs/specs/package-architecture/sandbox.spec.md`: app/bootstrap may compose the sandbox
          root layer, app-edge denial telemetry may use the diagnostics surface, and all product
          runtime launch-policy acquisition flows through runtime-owned command/session execution and
          `RuntimeLaunchPolicyService`.
    - [ ] `Sandbox.resolvePathAccess(...)` performs effectful canonicalization, symlink containment,
          executable metadata checks, and nearest-existing-parent resolution through injected
          `FileSystem.FileSystem` / `Path.Path` services, while preserving canonical/resolved path
          metadata in access decisions.
    - [ ] `Sandbox.buildLaunchPolicy(...)` validates supplied or resolved snapshots against launch
          input, scope, surface/session identity, command id, canonical cwd, launch kind,
          fingerprint, and managed profile digest before returning launch facts.
    - [ ] Sandbox helper candidates are immutable candidate declarations with path, platform, arch,
          expected digest, and allowed helper roots; sandbox validates allowed-root containment,
          current platform/arch, regular executable status, and digest before returning launch
          facts, and resolves only packaged or explicitly configured test helper identities.
    - [ ] Sandbox denial classification accepts only redacted excerpts, emits coarse denial reasons
          safe for command facts/app logs/renderer payloads, and never returns raw stdout, stderr,
          secret values, env values, or unallowlisted host paths as evidence.
  - [ ] Expose `PiAdapter` plus the root `@svvy/pi-adapter` `layer` for scoped pi session creation,
        prompt rebinding, ambient resource suppression, model metadata, turn streams, helper jobs,
        and pi-free event adaptation.
    - [ ] `@svvy/pi-adapter` public imports use only the `PiAdapter` service and layer factories for
          production pi behavior; `@svvy/pi-adapter/messages` remains adapter-owned conversion
          support and is not a production dependency unless a package-boundary test names an exact
          additional use.
  - [ ] `@svvy/extensions` is an Effect v4 service/layer package.
    - [ ] Expose the `@svvy/extensions` Effect service boundary for builtin registry
          reads, actor extension binding resolution, visible extension record projection, native tool
          schema document emission, and native tool command metadata lookup, with package tests and
          package-boundary coverage.
    - [ ] Expose the `request_user_input` native handler through `@svvy/extensions`, validating
          questions, deriving default answers, and returning exactly one model-facing result plus
          one ordered `ExtensionRuntimeOperation` item wrapping a `request_input.create`
          runtime-effect request; `@svvy/runtime` applies the effect, completes nonblocking
          defaults, and owns blocking wait, timeout, cancellation, recovery settlement, and command
          facts.
    - [ ] Expose actor-binding-aware `Extensions.nativeTools` handler lookup, generated-context
          build, and MDX instruction compilation methods with package tests for actor binding,
          validated workflow prompt string output, and native declaration parity.
    - [ ] `@svvy/extensions` owns actor prompt, generated-context preview, native tool declaration,
          `svvyx` guidance, and `execute_typescript` facade declaration composition through
          `Extensions.generatedContext.build(...)` and actor-binding-aware declaration services,
          with builtin base prompts and extension instructions sourced from `@svvy/extensions`
          MDX/source assets.
    - [ ] Expose `Extensions.sources` edit-session methods and `Extensions.generatedPackages`
          refresh methods with package tests for source fingerprinting, operation-scoped writes,
          generated evidence, plus separate immutable workspace-link plan production for
          runtime-owned link repair.
      - [ ] Public `Extensions` methods close over layer dependencies; callers do not receive
            per-method requirements such as `FileSystem`, `Path`, `Crypto`, `ExtensionStatePort`,
            generated-package roots, or workspace-link ports.
      - [ ] `Extensions.generatedPackages` and `Extensions.sources` methods require only
            `Extensions`; package tests reject per-call `FileSystem`, `Path`, `Crypto`, state-port,
            generated-root, source-root, and workspace-link requirements on public methods.
      - [ ] `Extensions.dependencies.planInstallOrUpdate(...)` and
            `Extensions.dependencies.refreshReadiness(...)` provide fake-probe-tested dependency
            planning, committed approval fact interpretation, persisted readiness facts, and no
            direct durable command execution from `@svvy/extensions`.
      - [ ] `Extensions.env.requirements(...)` returns declaration schemas, secret-ref
            requirements, redaction labels, and dependency/env readiness fact references;
            `Extensions.env.planExecutionEnv(...)` returns invocation-local env construction plans
            from secret refs, approved dependency facts, and explicit blocked-missing-secret or
            blocked-unapproved-dependency results.
      - [ ] The core-owned `ExtensionStatePort` exposes exactly the read capabilities required by
            `@svvy/extensions`: inventory, actor bindings, dependency readiness/approval, env
            readiness, source fingerprints, extension eligibility, and generated-package facts, with
            no state-command writes or runtime publication authority.
      - [ ] Native tool metadata and handler lookup are parity-tested: every emitted native tool
            either has a real handler or an explicit not-yet-callable state that prevents declaration
            to pi.
    - [ ] Package builtin default prompts/instructions as declared MDX source files under
          `@svvy/extensions`, compile them to plain prompt text before generated-context or
          generated-package emission, and make builtin extension records point at those packaged
          template files as their declared instruction source material.
    - [ ] Extension prompt/loading-hint records use the package-spec loaded-contributor model:
          ordered editable MDX contributors, scripted contributor source/output pairs, bypass state,
          compiled plain prompt output, and one generated prompt block per loaded extension.
    - [ ] Keep native tool handler lookup actor-binding-aware end to end: runtime passes the same
          actor binding used for pi declarations, extensions rejects tool-name-only authorization,
          and every native handler returns exactly one model-facing result plus ordered
          `ExtensionRuntimeOperation[]`.
    - [ ] Generated package file refresh writes into operation-scoped temp roots, validates
          persistent Workflows component/workflow imports before rendering, promotes staged output
          only after writes succeed, emits evidence manifests, and keeps the current ready package
          active when staged writes fail.
    - [ ] Generated package refresh returns package-owned build evidence after successful output
          promotion; `@svvy/runtime` records generated-package facts through core-owned state ports
          and handles workspace-link application/status facts through runtime-owned link repair.
    - [ ] `@svvyx/extensions` generated-package eligibility computes the current source root
          fingerprint from file-backed source/build inputs in the same refresh batch, uses committed
          `ExtensionStatePort` fingerprint rows only as comparison/diagnostic evidence, and includes
          the validated per-extension source fingerprint parts in generated-package evidence
          manifests.
    - [ ] Generated workflow task-agent types use exact core reasoning-effort unions.
    - [ ] `@svvy/state` exposes `createStateFacade(managedRuntime)` as the read-only read-model
          Promise facade and `createStateCommandsFacade(managedRuntime)` as the separate finite
          product-command Promise facade; both run over the app-owned `ManagedRuntime`, expose closed
          `StateFacadeErrorContract` failures, support post-admission abort/interruption mapping, and
          never expose runtime mutations, repositories, SQL handles, generic transactions, raw causes,
          SQLite errors, or invalidation descriptors as caller-facing payloads.
      - [ ] App/bootstrap constructs `createStateFacade(managedRuntime)`,
            `createStateCommandsFacade(managedRuntime)`, and a renderer-narrowed state facade over
            the routed app-global/workspace state graph; renderer RPC reads for `appLogs`,
            `appLogSummary`, `appPreferences`, `settings`, and `providerAuth` use that read facade,
            and app-log read-state, app-preference, and provider-auth status mutations use
            `StateCommandsFacade` so command promises resolve only after the runtime-owned
            post-commit notification port accepts committed descriptors.
    - [ ] State access uses the package-appropriate narrow boundary only: runtime, extensions,
          pi-adapter, sandbox, and generated packages consume core-owned state ports; desktop,
          browser-tool, headless, and non-bootstrap app code consume approved state read/command
          facades supplied by app bootstrap; no consumer imports `StateStore`, repositories, SQL
          helpers, transactions, migrations, table helpers, structured-session stores,
          `*FromStore` helpers, or restricted structured-session wiring subpaths except through the
          exact bootstrap/test allowlist.
    - [ ] Keep generated-package file writers and Workflows package refresh internals
          package-private behind `Extensions.generatedPackages.refresh(...)`; the
          `@svvy/extensions` package root exposes only `Extensions`, `layer`, service contracts,
          and approved package-local host/config ports required by `Extensions.layer`, while
          generated-package refresh/discovery internals stay behind service methods or explicitly
          named package-private/test-only helpers.
    - [ ] `@svvy/extensions` root exports only `Extensions`, `layer`, service contracts, and
          approved package-local host/config ports; generated package renderers, native handler
          modules, source edit internals, builtin records, and writer helpers stay package-private
          or test-only behind `Extensions` service methods.
    - [ ] Make generated `defineTaskAgent` calls reject during generated-package validation unless
          exactly one `promptSource` value is provided.
  - [ ] `Runtime.messages.submit` performs the durable queue insert through
        `RuntimeQueueStatePort`, turns committed `afterCommit` descriptors into typed runtime
        notifications through the runtime-owned publication path, maps publication failures to typed submit errors, and invokes a
        runtime-owned `RuntimeMessageSubmissionPostCommitLane` only after publication; app/bootstrap
        supplies only composed package layers, primitive host adapters named by the runtime spec, and
        renderer/browser/headless facades. `@svvy/runtime` owns pi-session materialization through
        `@svvy/pi-adapter`, queue wake/claim policy, notification publication, and state-port lookup.
    - [ ] `Runtime.messages.abort` handles the queued-message branch through
          `RuntimeQueueStatePort`, validates queued-row target ownership before mutation, publishes
          committed `afterCommit` descriptors through the runtime-owned notification publication path, maps lookup/cancel
          failures to typed abort errors, and invokes a runtime-owned queued-message abort
          post-commit lane only after publication so queue wakeup and surface refresh behavior stay
          inside runtime services.
    - [ ] `Runtime.approvals.answer` resolves durable approval requests through
          one `RuntimeApprovalStatePort` transaction that settles the request, starts or cancels the
          bound command, and clears the matching approval wait; publishes the transaction's
          committed `afterCommit` descriptors through the runtime-owned notification path; and
          invokes the runtime-owned approval wait lane only to resolve the existing live waiter.
    - [ ] `Runtime.sourceInvalidation` exposes fully wired `hint`, `reconcile`,
          `refreshGeneratedContext`, and `refreshGeneratedPackages` methods; missing wiring is a
          composition error and unsupported source-domain/scope combinations return explicit
          product contract errors.
    - [ ] `WriteCommandStdinResult` matches the runtime command-session contract: every result
          returns `commandId` plus one closed status (`accepted`, `stdin_closed`, `not_running`, or
          `already_terminal`), accepted writes must report the exact accepted UTF-8 byte count as
          `acceptedBytes`, non-accepted statuses do not carry byte counts, and backpressure remains
          a typed `RuntimeContractError` rather than a success status.
    - [ ] `RuntimeCommandStatePort.recordStdinWrite(...)` persists accepted stdin writes as durable
          command events with exact text, exact accepted byte count, and command-inspector
          invalidation, while public stdin admission, backpressure, process handles, and live
          command-session lookup remain runtime-owned command-session behavior.
    - [ ] `Runtime.commands.writeStdin(...)` validates durable command identity through
          `RuntimeCommandStatePort.findCommandById(...)`, uses
          `RuntimeCommandSessionService.writeStdin(...)` for live admission by durable `commandId`,
          records accepted writes
          through `RuntimeCommandStatePort.recordStdinWrite(...)`, publishes committed
          command-inspector invalidations, returns terminal/missing-live statuses without state
          writes, and keeps transient Shell `session_id` continuation lookup inside the
          agent-facing direct tool only; desktop, browser-tool, and headless callers use durable
          `CommandId` stdin APIs.
    - [ ] Desktop renderer adapters expose a renderer-safe command stdin action backed by
          `runtime.commands.writeStdin({ commandId, text, clientSubmission })`, route by explicit
          workspace/runtime facade identity only, and keep process handles, Shell `session_id`,
          focused panes, and renderer command state out of the product boundary.
  - [ ] Expose the `@svvy/runtime` package boundary: the root exports only `Runtime`,
        `Runtime.layer`, `layer`, and `createRuntimeFacade(...)`;
        `@svvy/runtime/prompt-execution-context` exposes only the narrow runtime-owned
        prompt-execution context constructor, live-handle type, and core DTO type re-exports named
        by the runtime spec; `@svvy/runtime/accepted-native-tool-execution` exposes only
        app-bootstrap Promise adapters over the already acquired app-owned `ManagedRuntime`;
        `@svvy/runtime/source-invalidation-coordinator-adapter` exposes only the closeable
        source-coordinator handle factory and handle/options types for app-bootstrap source-root and
        workspace-scope binding; `@svvy/runtime/bootstrap` exports only app-composition primitives named
        by the runtime spec, including
        config/readiness/shutdown helpers, runtime startup receipt/error types, the Bun platform
        layer, primitive prompt cancellation, surface queue wake, command stdin/control,
        provider-auth/model lookup, generated-context refresh, generated-package refresh, and
        source-invalidation scan host ports. The Smithers task-agent loopback bridge is an
        app-bootstrap binding around the runtime-owned authenticated `runTaskAgent` path, not a
        public bootstrap export. Runtime event buses, semantic source coordinators,
        generated-package repair internals, queue dispatchers, wait registries, runtime-effect
        appliers, accepted-tool helpers, semantic callback ports, broad catalog ports, runtime layer
        requirement types, and prompt-execution context constructors stay package-private or
        test-fixture-only.
    - [ ] Runtime bootstrap exposes the defaulted `RuntimeLayerConfig`, config schemas/helpers,
          config-service provisioning, and runtime-owned startup-readiness/shutdown-preparation hooks
          for the app bootstrap graph; app/bootstrap owns any `SVVY_RUNTIME_*` host env reads and
          passes decoded typed config into the runtime layer.
    - [ ] `Runtime.layer` is a no-argument production
          `Layer.Layer<Runtime | RuntimeStartupReadiness | RuntimeShutdownPreparation | StateCommandPostCommitNotificationPort, RuntimeLayerError, RuntimeLayerRequirements>`
          that builds the `Runtime` service and package-private runtime startup readiness,
          shutdown preparation, event publication, queue/wait/command/source, and post-commit
          notification services inside the package; service-lift fixtures use
          `Layer.succeed(Runtime, fake)` only inside tests or internal fixtures, never through a
          package-root helper.
    - [ ] Runtime facade groups live in package-owned `@svvy/runtime` Effect service construction.
          App/bootstrap provides explicit runtime-required app-bootstrap host adapters plus
          config/readiness/shutdown layers, composes `Runtime.layer`, awaits
          `managedRuntime.context()` and startup readiness, and never lifts an app-built service with
          `Layer.succeed(Runtime, service)`.
    - [ ] Runtime service methods close over the core-owned state ports supplied through
          `Runtime.layer`; facade callers never provide `RuntimeQueueStatePort`,
          `RuntimeRequestStatePort`, `RuntimeApprovalStatePort`, `RuntimeCommandStatePort`, or
          `RuntimeSessionWaitStatePort` directly. App/bootstrap wires those ports once during layer
          composition as the product boundary.
    - [ ] `@svvy/runtime` has no direct `@svvy/state` package dependency or production source
          import; runtime state access goes through core-owned state port service tags provided by
          app/bootstrap layer composition, and runtime tests use only package-local fakes or the
          app/bootstrap-level integration fixtures named by package-boundary tests.
    - [ ] `@svvy/*` package sources cannot import across package roots with relative
          paths; package-boundary tests resolve relative imports and require cross-package access to
          use approved public package names.
    - [ ] App bootstrap, browser-tool bridge, headless entrypoints, desktop bridge files, and
          renderer/shared code import package behavior only through package names and export maps; no
          source-checkout-relative imports into `packages/runtime/src/**`, `packages/state/src/**`,
          runtime prompt/wait/queue/source/repair/event internals, state private stores, or
          package-private implementation modules remain.
    - [ ] Runtime receives direct core-owned state ports and package service requirements while
          app/bootstrap wires state/package/platform layers only; runtime owns provider/model
          resolution, prompt submission logging, queue insertion/wake policy, request-input waits,
          approval waits, live prompt cancellation, source-invalidation handles, generated-package
          refresh policy, and runtime notification publication/subscription semantics without
          callback tables.
    - [ ] Prompt dispatch, request-input waits/answers, and approval waits/answers are
          runtime-owned services backed by core-owned state ports, command facts, wait registries,
          and runtime notifications; runtime layer requirements contain no broad prompt-host,
          request-input callback, or approval callback ports. The only prompt-named host
          requirement is the narrow live cancellation `RuntimeLayerPromptControlHostPort`, which
          cannot resolve defaults, queue work, publish events, materialize prompts, or expose pi
          handles.
    - [ ] A package-private `RuntimeQueueWakeService` inside `Runtime.layer` wakes committed
          message submissions, queue insertions, request-input answer delivery, queued-message
          aborts, queue steering, recovery, and workspace acquire transitions
          wake runtime-owned surface/workspace lanes from DB-backed state facts through
          runtime-owned wake services; app/bootstrap callback methods are outside the queue-wake
          contract.
    - [ ] Package-private generated-package refresh and workspace-link repair wake/schedule services
          exist, including `RuntimeGeneratedPackageWorkspaceLinkRepairService`, so committed
          generated-package fact changes wake runtime-owned workspace-link repair service work without
          using the surface queue wake API.
    - [ ] Package-private `RuntimeRequestInputWaitService` inside `Runtime.layer` makes
          blocking accepted-tool calls wait through `waitForBlockingRequest(...)`, request-input
          answer commits resolve matching blocking waits, queued nonblocking answer delivery wakes
          the owning surface queue, and timer pause/resume reschedules through core-owned request,
          command, session-wait, and queue services without `afterRequestInputAnswered` or
          `afterRequestInputTimerPaused` callback ports.
    - [ ] Runtime-owned accepted native-tool approval execution keeps approval request
          creation, live `Deferred` waiting through the `Runtime.layer`-owned
          `RuntimeApprovalWaitService`, approval answer resolution, cancellation, command
          settlement, and notification publication inside runtime-owned services without
          app/bootstrap approval callback ports; user-review admission atomically creates the
          request, moves the linked command to `waiting`, and records its approval wait.
    - [ ] Package-private runtime-owned queue dispatch services use runtime-owned
          workspace/surface scope services, queue state ports, and runtime-local wake hints so queue
          claim/drain work is owned entirely by `@svvy/runtime`.
    - [ ] `RuntimePromptDefaultsService` is a package-private dispatch resolver that composes
          durable prompt defaults, committed actor prompt binding, generated-context
          freshness/refresh, actor extension binding, native tool declarations, and
          command-projection metadata without any app prompt-host boundary.
    - [ ] Package-private `RuntimePromptExecutionService` and the required `@svvy/pi-adapter`
          session/turn APIs materialize claimed queued messages into pi turns,
          stream consumption, accepted tool execution, command facts, cancellation, title scheduling,
          queue settlement, and runtime events without `RuntimeLayerPromptHostPort`.
    - [ ] Make `@svvy/runtime` the only prompt-bearing pre-dispatch owner: after queue claim and
          before `@svvy/pi-adapter.turns.run(...)`, runtime resolves durable prompt defaults, reads
          the committed actor binding, calls `Extensions.generatedContext.build(...)` when refresh is
          required, persists the generated-context binding through state ports, requests
          actor-specific tool declarations from `@svvy/extensions`, and passes only the bound
          `systemPrompt` plus declarations to `@svvy/pi-adapter`.
    - [ ] The complete pi turn/tool-call loop runs inside `@svvy/runtime`: turn record commit, pi
          stream consumption through `@svvy/pi-adapter`, streamed tool argument projection,
          accepted native-tool handler lookup/invocation through `@svvy/extensions`, runtime
          operation application, command fact settlement, and queue release all run inside runtime
          services.
    - [ ] Package-private runtime-owned surface scope services acquire each surface's scoped Effect
          resource used when calling `@svvy/pi-adapter` `sessions.create(...)`,
          `sessions.open(...)`, and `history.forkFromEntry(...)`. Each surface scope owns the live
          pi session handle, prompt lock, active prompt fiber, wait registries, command-session
          handles, and finalizers while durable session, transcript, command, wait, and lifecycle
          facts remain DB-backed state.
    - [ ] Runtime source invalidation, generated-context refresh, generated-package refresh,
          workspace-link repair, committed invalidation publication, and recovery scheduling are
          runtime-owned Effect services backed by `@svvy/extensions`, core-owned state ports, and
          primitive filesystem/path services. `Runtime.layer` contains
          package-private semantic source-invalidation, generated-context refresh,
          generated-package refresh, and workspace-link repair services; runtime layer requirements
          contain no semantic source-invalidation callback port and may depend only on the
          spec-named primitive `RuntimeSourceInvalidationScanPort` host adapter.
    - [ ] Runtime layer requirements include the direct `Extensions` package service, pi-adapter
          layer dependencies, sandbox host-support and policy-source dependencies consumed through
          package-private `RuntimeLaunchPolicyService`, and core-owned state ports needed by each
          exposed production runtime method; every public
          `Runtime` and `createRuntimeFacade(...)` method exists only with complete runtime
          ownership, method-ledger coverage, and tests proving no hidden app callback path exists.
      - [ ] `RuntimeLayerRequirements` contains only concrete package services, core-owned state
            ports, platform services, bootstrap config/readiness services, and the narrow
            spec-approved primitive host ports. Generated-context refresh, generated-package
            refresh, source invalidation scan, command stdin/control, queue wake, request-input,
            approval, and accepted-tool semantics are runtime-owned services backed by package
            services and core-owned ports, not production app/bootstrap callback ports.
    - [ ] `RuntimeAcceptedNativeToolExecution` and `RuntimeExecutionPlanExecutor` are
          package-private runtime-owned services composed inside `Runtime.layer` internals and
          hidden from public package-root, bootstrap, facade, renderer, desktop, browser-tool,
          headless, and extension APIs; request-input, load-extension, thread-start, and
          execution-plan paths return only model-facing native tool results, apply `runtime_effect`
          and `execution_plan` items in the owning command lane, publish committed invalidations
          through the real runtime event bus, and route approval, sandbox, subprocess, file, stdin,
          stdout/stderr, artifact, handler-thread preparation, and child-command effects through
          runtime-owned services and state ports. App production code
          imports accepted native-tool execution only through
          `@svvy/runtime/accepted-native-tool-execution`, imports no accepted-tool bootstrap
          helpers, and owns no command envelope allocation,
          blocking wait, applied-effect mutation, or no-op event publication for accepted tools.
    - [ ] `RuntimeLayerRequirements` are backed by the core-owned state ports required by the
          runtime service: `RuntimeWorkspaceStatePort` records scoped durable workspace
          acquire/default/release owner facts, `RuntimeSurfaceLifecycleStatePort` records durable
          surface create/open/close lifecycle facts, and `RuntimeSourceStatePort` records editable
          source-version/source-save/source-delete facts plus deterministic source scan,
          observed-deletion, and diagnostic facts keyed by invalidation scope/domain. These ports are implemented by
          `@svvy/state`, return committed after-commit descriptors, and are
          wired into `Runtime.layer` composition. Runtime-owned scoped workspace/surface/pi
          resources stay in `Runtime.layer` / keyed runtime layers.
    - [ ] Public runtime groups for workspace lifecycle, surface lifecycle, and command
          cancellation are exposed only through the runtime method ledger, core schemas,
          state/package ports, runtime-owned services, runtime events, shutdown behavior, and
          focused facade tests.
      - [ ] Keep extension dependency install/update unavailable through public runtime facades;
            dependency approval answering remains command-scoped and must not imply install/update
            admission.
      - [ ] `Runtime.commands.cancel(...)` resolves durable `CommandId` through
            `RuntimeCommandStatePort.findCommandById(...)`, routes cancellation through
            `RuntimeCommandSessionService.cancel(...)`, records terminal command facts, cleans wait
            registries, and keeps live process handles inside runtime-owned command sessions.
    - [ ] `@svvy/runtime` root exports only `Runtime`, `Runtime.layer`, `layer`, and
          `createRuntimeFacade(...)` as values; the approved `./prompt-execution-context` subpath
          owns prompt-execution context construction helpers; runtime facade types, facade error
          classes, transport appliers, operation appliers, event-bus internals, and bootstrap helpers
          are absent from the package root.
    - [ ] App and desktop consumers derive runtime facade/service TypeScript shapes from
          bootstrap-owned facade factories or adapter return types; runtime root facade/service type
          aliases are not part of the app/desktop contract.
    - [ ] `@svvy/runtime/bootstrap` exports only runtime app-composition primitives:
          `RuntimeLayerConfig`, `RuntimeLayerConfigInputSchema`, `RuntimeLayerConfigSchema`,
          `RuntimeLayerConfigFromEnv`, `defaultRuntimeLayerConfig`, `RuntimeLayerConfigService`,
          `RuntimeLayerError`, `RuntimeLayerErrorSchema`, runtime-layer error encode/decode helpers,
          `RuntimeStartupPhase`, `RuntimeStartupReadiness`, `RuntimeStartupReadinessReceipt`,
          `RuntimeStartupDegradedPhase`, `RuntimeStartupError`, `RuntimeStartupErrorSchema`,
          primitive prompt-cancellation, surface-queue wake, command-stdin/control,
          provider-auth/model-lookup, generated-context refresh, generated-package refresh, and
          source-invalidation scan host ports, `RuntimeSurfaceQueueWakeReason`,
          `RuntimeShutdownPreparation`, `RuntimePrepareShutdownReason`,
          `RuntimePrepareShutdownRequest`, `RuntimePrepareShutdownResult`,
          `createRuntimeLayerConfigLayer(...)`, `awaitRuntimeStartupReadiness(...)`,
          `prepareRuntimeShutdown(...)`, `layerRuntimeStartupReadiness`,
          `layerRuntimeShutdownPreparation`, `layerRuntimeBunPlatform`, and
          `RuntimeBunPlatformServices`; the Smithers task-agent loopback bridge is an
          app-bootstrap binding around runtime-owned authenticated `runTaskAgent`, not a current
          `@svvy/runtime/bootstrap` export; desktop/browser/headless facade adapters are
          app/bootstrap-owned and not bootstrap-subpath exports; the underlying
          startup-readiness, shutdown-preparation, event bus, wait registry, semantic source
          coordinator, queue dispatcher, generated-package repair internals, accepted-tool helpers,
          and bridge implementation services stay package-private.
      - [ ] Package-boundary tests reject extra `@svvy/runtime/bootstrap` exports, including
            accepted-tool helpers, source coordinators, generated-package refresh internals, queue
            dispatchers, wait-registry constructors, generated-package repair executors, and
            semantic callback ports not explicitly named by the runtime spec; the bootstrap export
            allowlist contains no internal-service exceptions.
    - [ ] Runtime implementation helpers are package-private or test-fixture-only. Product app code
          reaches runtime behavior only through `Runtime.layer`, the named
          `@svvy/runtime/bootstrap` app-composition primitives,
          `@svvy/runtime/accepted-native-tool-execution`,
          `@svvy/runtime/source-invalidation-coordinator-adapter`, and
          `createRuntimeFacade(...)`;
          operation appliers and internal service constructors are not app/bootstrap dependencies.
    - [ ] Runtime owns prompt execution context derivation, content-stripping construction helpers,
          and live invocation/runtime handles; only the narrow constructor and live-handle type
          surface named by the runtime spec is exported from
          `@svvy/runtime/prompt-execution-context`, while `@svvy/core` exports only schema-backed
          `PromptExecutionContext` data contracts, derived types, and boundary codecs. Runtime-owned
          production derivation and all other prompt-execution helpers remain package-private.
    - [ ] `PromptExecutionContext` does not carry submitted prompt text; runtime prompt dispatch
          keeps the current user message as a local dispatch input, while reusable prompt execution
          context carries only stable prompt metadata.
    - [ ] `PromptExecutionContext` carries external instruction identity, actor binding,
          read-status, order, and content hash metadata without carrying external instruction file
          bodies; generated context composition and inventory display keep using
          `@svvy/extensions`-owned file-backed source records, and `svvyx` subprocess environment
          context receives only the metadata view.
    - [ ] App bootstrap composes the package graph once, creates exactly one app-owned
          `ManagedRuntime`, awaits `managedRuntime.context()` plus
          `awaitRuntimeStartupReadiness(managedRuntime)`, exposes desktop/browser/headless facades
          only after readiness, composes state-port layers and primitive host adapters once, exposes
          renderer-safe runtime/state facades routed by explicit `workspaceId`, `PromptTarget`,
          `RuntimeSurfaceTarget`, `surfacePiSessionId`, `commandId`, `requestId`, `approvalId`, or
          queued-message identity, owns browser-tool/headless Promise/callback/`AsyncIterable`
          edge adapters without direct restricted-state or runtime-internal wiring, runs
          `prepareRuntimeShutdown(managedRuntime, ...)` before disposal, and never exposes two
          healthy app runtimes at the same time.
    - [ ] The app runtime bootstrap boundary uses explicit package/state/platform layers and
          primitive host adapters directly; production app bootstrap owns only the app-runtime
          composition and facade adapter edge, not catalog-backed runtime ports, callback runners,
          prompt runners, queue-dispatch runners, semantic source-invalidation runners,
          approval/request-input runners, command runners, or workspace/surface lifecycle runners.
          Source-coordinator lifecycle and scan entry use only the named
          `@svvy/runtime/source-invalidation-coordinator-adapter` handle surface and do not make
          source-invalidation policy an app-bootstrap responsibility.
          `@svvy/runtime` owns those services through package services, core-owned state ports, and
          package-private runtime scope services.
    - [ ] Runtime startup readiness is a real runtime-owned Effect that verifies required runtime
          coordinators, package services, state ports, event publication, workspace/surface runtime
          scope services, and loopback bridge readiness before desktop/browser/headless facades are
          exposed.
    - [ ] Runtime shutdown preparation is a real runtime-owned Effect that stops accepting new work,
          drains or records active queue/command/wait state, closes runtime event subscriptions,
          shuts down workspace/surface runtime resources, and returns a shutdown receipt before the
          app-owned `ManagedRuntime` is disposed.
    - [ ] Workspace runtime scopes are acquired through package-private runtime-owned Effect scope
          services inside the single app-owned `ManagedRuntime`. Each service owns scoped keyed
          resources using adopted Effect primitives, explicit finalizers, and state-backed readiness;
          candidate primitives such as `LayerMap` remain unused in production until explicitly
          adopted with manifest and boundary-test coverage. Desktop, browser-tool, headless, and
          app/bootstrap edge adapters never create independent runtime graphs and never own queue,
          prompt, state, recovery, generated-package, or tool-execution policy.
    - [ ] Package-private workspace and surface scope services live inside `Runtime.layer`:
          workspace lookup resolves durable workspace/session facts and acquires one scoped
          workspace runtime resource keyed by `WorkspaceSessionId`, surface lookup acquires one
          scoped surface runtime resource keyed by durable `SurfacePiSessionId` under its owning
          workspace runtime scope, and workflow task-agent bridge acceptance acquires one task
          attempt scope keyed by `WorkflowTaskAttemptId` plus owning workspace/session lineage.
          Workspace scopes own source invalidation, generated-package link repair, recovery, and
          workspace-keyed runtime resources. Surface scopes own the pi-session `Scope.Scope`, queue
          dispatch, wait, cancellation, command-session, and live invocation resources keyed by
          durable surface identity, with no caller-provided pi-adapter queue-runner bridge.
    - [ ] Runtime event subscriptions expose the specified subscription object with `close()` and a
          close receipt, publish events into replay storage before fanout, enforce bounded
          subscriber buffers with rebaseline errors, and include required generation ids in every
          emitted event.
      - [ ] Runtime event-bus shutdown distinguishes app shutdown from runtime restart before
            disposal, closes every open subscriber exactly once with `runtime-shutdown` or
            `runtime-restart`, and returns typed close receipts rather than stream errors for
            post-subscription shutdown, restart, slow-consumer overflow, or explicit unsubscribe.
      - [ ] Runtime event replay validates `eventGenerationId`, `afterSequence`, workspace/app
            filters, and replay-window losslessness before exposing a stream; stale cursors,
            generation changes, or non-lossless filters fail setup with
            `RuntimeEventRebaselineRequired` carrying affected read-model descriptors for the
            caller to refetch.
      - [ ] Durable transcript state owns target-local `streamGenerationId` and `streamSequence`;
            runtime advances that cursor before each transcript patch, rejects publication gaps,
            emits `stream_reset` patches for `rebaseline_required`, `runtime_recovered`, and
            `surface_reopened`, and requires consumers to discard stale live patches and refetch
            durable surface/transcript/command read models.
      - [ ] Runtime pi-event consumers and surface lifecycle services publish core
            `surface.stream` and `surface.changed` runtime events, including `surface.updated`,
            `prompt.started`, `prompt.settled`, `background.started`, and `surface.closed` reasons,
            through the runtime event bus; app/bootstrap maps those events to renderer-safe
            notifications, and renderer-only stream patch payloads remain bridge-local derived
            payloads rather than the product event contract.
      - [ ] App/bootstrap maps runtime event setup failures, `RuntimeEventRebaselineRequired`, and
            subscription close receipts into renderer-safe/headless-safe rebaseline notifications
            carrying `eventGenerationId`, `lastContiguousSequence` or failed cursor details,
            optional workspace identity, and the affected read-model descriptors to refetch.
    - [ ] Runtime source-edit workflow-agent APIs use the exact core-owned source-edit DTO
          contracts, delegate file-backed reads/writes to `@svvy/extensions`, record source facts
          through state ports, and schedule generated-context/generated-package reconciliation after
          committed state mutation results.
    - [ ] Source-edit request/result DTOs and schema decoders live in
          `@svvy/core/runtime-source-edit-contracts`; `@svvy/runtime` and app bootstrap consume them
          from `@svvy/core`, and `@svvy/extensions` does not export those shared contracts.
    - [ ] Runtime source invalidation, command-session, and approval APIs include realistic success
          and rejected examples in the package spec and typed tests covering their public
          input/output contracts.
    - [ ] Workflow task-agent `runTaskAgent` bridge requests are handled by runtime-owned
          authenticated bridge services with durable idempotency, queueing, task-attempt surface
          lifecycle, generated-context binding, command facts, and pi-adapter delivery handoff;
          app/bootstrap hosts only the command-scoped transport binding, and no pi-adapter runner
          bridge or bootstrap queue/prompt runner handles task-agent dispatch.
  - [ ] Run surface queue dispatch policy as a package-owned `@svvy/runtime` Effect over
        `RuntimeQueueStatePort`; runtime owns claim/dispatch policy, calls `@svvy/pi-adapter`
        through its public service boundary for retained pi materialization and prompt start, and
        publishes runtime notifications after committed after-commit descriptors. App bootstrap supplies
        the composed layers and edge facades only.
- [ ] Define core-owned runtime submission contracts in `@svvy/core`: user-messageable
      human/composer submit targets for orchestrator and handler surfaces, resolved
      `RuntimeSurfaceTarget` values for queue/runtime addressing, submit/abort/steer inputs and
      results, runtime events, and `RuntimeEffectRequest` schemas without renderer panel ids or
      pi-native message types.
  - [ ] `@svvy/core` owns runtime prompt target, workflow-task runtime surface target,
        submit/abort/steer, submitted message, delivery, and compact runtime event contracts with
        strict boundary decoders that reject renderer-only submission fields.
  - [ ] Define the closed `RuntimeEffectRequest` schemas and command-fact request inputs in
        `@svvy/core` as declarative outputs returned by extension handlers for `@svvy/runtime` to
        apply through `@svvy/state`.
    - [ ] Add the runtime request-input state port contracts, apply the first
          `request_input.create` effect, and expose `runtime.requestInput.answer` with
          `AnswerRequestInputInput`, answer recording, and the spec-shaped
          `AnswerRequestInputResult.delivery` variants through `@svvy/runtime` with package tests
          and boundary coverage.
    - [ ] Complete durable request-input answer idempotency: normalized `clientSubmission` values
          return `status: "duplicate"` with the original `AnswerRequestInputResult.delivery`,
          perform no second post-commit wake, queue wake, live wait resolution, invalidation
          publication, answer-row insert, queue-row insert, or command settlement, nonblocking
          recorded-only answers do not resolve blocking waits, and committed nonblocking queued
          answers publish queue/surface invalidations only when a queue row is created.
    - [ ] Apply `handler_thread.start` through runtime-owned handler lifecycle services, state
          ports, command facts, queue insertion, after-commit notifications, and tests.
      - [ ] Apply the prepared durable handler-thread start through `RuntimeThreadStatePort`,
            publish committed `afterCommit` descriptors through the runtime-owned notification
            publication path, and wake each
            committed `initial_handler_start` queue row through `RuntimeQueueInsertPostCommitLane`.
      - [ ] Runtime materializes full `thread_start` handler setup through runtime-owned services;
            app/bootstrap supplies only composed layers and edge facades.
    - [ ] Apply `queue.insert` through runtime-owned queue insertion services, state ports,
          idempotency, committed `afterCommit` invalidation publication, and a runtime-owned
          `RuntimeQueueInsertPostCommitLane` that runs only after publication.
      - [ ] Add the `RuntimeEffectRequest` `queue.insert` applier through
            `RuntimeQueueStatePort`, preserving typed payload storage and focused tests.
    - [ ] Expose `Runtime.queues.steer(...)` through runtime-owned queue steering services, state
          ports, after-commit wakeups, and tests. Queue steering remains a public
          `Runtime.queues.steer(...)` operation; extension effect paths that need urgent delivery
          create typed queue rows through `queue.insert` with explicit priority, ordering, timing,
          and idempotency facts.
      - [ ] Add queue-row steering through the runtime queue service and `RuntimeQueueStatePort`,
            validating queued-row target ownership before mutation, publishing committed
            invalidations, waking delivery through the runtime-owned queue wakeup lane, and covering
            it with focused package and adapter tests.
    - [ ] Apply `actor_extension_binding.update` through current-surface binding services, state
          ports, generated-context stale marking, after-commit invalidations, and tests.
    - [ ] Apply `episode.record` through runtime-owned thread episode services, state ports,
          command/thread linkage, after-commit invalidations, and tests.
    - [ ] Apply `generated_context.refresh` through runtime-owned safe-boundary refresh scheduling,
          `@svvy/extensions` context generation, state ports, diagnostics, after-commit
          invalidations, and tests.
    - [ ] Apply `generated_packages.refresh` through runtime-owned app-global refresh scheduling,
          `@svvy/extensions` generated-package services, state ports, workspace-link repair
          scheduling, after-commit invalidations, and tests.
  - [ ] Schema-back all public `@svvy/core` read-model and native-tool contract documents,
        including app-log, session-navigation, command fact payloads, request-input questions,
        pi-adapter ports, sandbox policy ports, generated facade metadata, and runtime event-stream
        failure errors.
  - [ ] Queue workflow task-agent bridge requests as `workflow_task_agent_start` durable runtime
        work with row-level source-command lineage, no bridge-supplied system messages, and normal
        runtime queue claiming, turn creation, recovery, and event publication.
  - [ ] Persist target surface queue rows with `workflow_task_agent_start`, row-level workflow task
        and source-command lineage, priority/order sequence, claim lease/version, retry metadata,
        and expired-claim release through `@svvy/state`.
  - [ ] Expose runtime turn lifecycle through `RuntimeTurnStatePort` for turn start, turn decision,
        and turn finish operations used by the prompt execution path.
  - [ ] Runtime consumes only the core-owned runtime-facing state port tags named by the state spec,
        including queue, turn, command, approval, workspace, surface lifecycle, composer draft,
        source, prompt defaults, actor extension binding, episode, thread, request, session wait,
        extension-context impact, generated package, artifact, recovery, and read-model ports.
    - [ ] `RuntimeComposerDraftStatePort`, `RuntimeQueueStatePort`, and
          `RuntimeRequestStatePort` expose schema-backed core-owned contracts for draft cleanup,
          submitted-message acceptance, queue insertion, idempotency replay, request creation,
          request snapshots, answer delivery, timer pause/default/cancel, and invalidation
          descriptors; `@svvy/state` implements each method through package-private transactional
          SQLite/state methods without exposing structured-session storage as a public dependency.
    - [ ] Expose `RuntimeThreadStatePort.ensureHandlerThreadRunnable(...)` for runtime/native-tool
          code that must make a handler thread runnable and clear its wait projection without raw
          store access.
    - [ ] Route request-input tool execution through runtime-facing turn, command, request-input,
          queue, and wait state ports; no accepted-tool path uses package-private
          structured-session-state implementation access.
    - [ ] Request-input blocking waits are runtime-owned end to end: wait registration, timeout
          defaulting, pause/resume, stale timer suppression, cancellation, surface close,
          restart/recovery, command terminal facts, wait projection, and queue wakeups all run
          through `@svvy/runtime` services over core-owned state ports.
      - [ ] Finish package-private `RuntimeRequestInputWaitService.waitForBlockingRequest(...)` with
            internal registry `Deferred` handoffs, Effect clock/sleep timeout fibers, explicit
            registry close semantics, runtime-facing request/command/wait/queue ports, and
            deterministic `TestClock` coverage.
      - [ ] Compose request-input answer, timer, and queued-delivery writes through runtime-owned
            lifecycle services that publish committed after-commit descriptors before resolving live
            waits or waking owning surface queues.
      - [ ] Make blocking request-input terminal request/answer resolution one durable
            compare-and-set transition keyed by `requestId`, owning command id, request status, and
            timer version/deadline that atomically terminalizes the request and linked command and
            clears only its matching durable session wait. The first terminal commit wins, and
            losing contenders observe `stale-state` without publishing invalidations, resolving
            `Deferred`s, inserting answer or queue rows, or settling commands.
    - [ ] Compute extension usage impacts and affected-surface binding updates through runtime-owned
          generated-context binding and fingerprint reconciliation, preserving command output/fact
          behavior through named core-owned state ports.
    - [ ] Request-input answer and timer state writes publish committed
          after-commit descriptors through runtime-owned notification publication, then resolve live
          waits or queue delivery through package-private runtime services.
    - [ ] Compose request-input settings reads, wait-registry wiring, timeout scheduling, queue
          wakeups, and pi materialization through runtime-owned services plus state ports/facades;
          keep app-bootstrap host-adapter code limited to bootstrap wiring, host adapter provision,
          and facade exposure.
    - [ ] The full accepted-tool blocking request-input path runs inside `@svvy/runtime` services
          with deterministic `TestClock` coverage for timeout pause/resume, cancellation, surface
          close, and restart/recovery; Promise conversion exists only at app facade/tool boundaries.
    - [ ] Return `StateMutationResult<T>` from every mutating runtime-facing state port so runtime
          lanes can distinguish committed values from committed after-commit invalidation
          descriptors.
    - [ ] Core-owned workspace, surface-lifecycle, and source state-port coverage keeps
          `RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`,
          `RuntimeSourceStatePort`, and `StateMutationResult` contracts aligned with package-boundary
          service-tag tests for every remaining mutating/read path.
    - [ ] `@svvy/state` has SQLite-backed implementations for the remaining workspace,
          surface-lifecycle, editable source-fact, source scan-fact, state-revision, exported layer,
          focused test, and package-boundary export-ledger gaps in the core-owned state-port set.
    - [ ] Route `runtime.workspaces.acquire/acquireDefault/release` and
          `runtime.surfaces.createOrchestrator/open/close` through the injected core-owned state
          ports, publish returned after-commit descriptors through the runtime event publication
          boundary, expose the path through `createRuntimeFacade(...)` over the
          single app-owned `ManagedRuntime`, and cover it in the Effect test lane plus adapter unit
          tests.
    - [ ] Runtime workspace/surface lifecycle methods acquire and release runtime-owned
          workspace/surface scopes, materialize pi sessions through `@svvy/pi-adapter`, start source
          and recovery workers, and return readiness only after the live runtime resources are
          available or a degraded readiness result has been committed.
    - [ ] Every runtime service collects committed after-commit descriptors
          and publishes them through runtime-owned notification publication; app/bootstrap host
          adapters call facades or return closed operation results and do not consume state ports
          directly.
      - [ ] All runtime snapshot-impact callers consume
            `RuntimeExtensionContextImpactStatePort` mutation results, collect committed
            after-commit descriptors, and publish runtime notifications only
            from committed descriptors.
  - [ ] `@svvy/state` implements all core-owned runtime-facing state ports through one
        package-private SQLite-backed state layer, and every mutating port method commits atomically
        and returns `StateMutationResult<T>` with authoritative after-commit invalidation
        descriptors.
  - [ ] `@svvy/runtime` owns prompt submission, queue claiming, active-turn lifecycle, stream
        finalization, and recovery.
    - [ ] `Runtime.layer` requires only core-owned state ports, the direct `Extensions` package
          service, pi-adapter layer dependencies, sandbox host-support and policy-source
          dependencies consumed through package-private `RuntimeLaunchPolicyService`, primitive
          platform/host ports, and bootstrap config ports; source
          coordination, event publication, queue dispatch services, accepted native-tool execution, and
          startup readiness are package-private runtime-owned services composed inside
          `Runtime.layer`; app/bootstrap composes the providing layers
          inside the single app-owned `ManagedRuntime`, and package-boundary tests reject any
          additional package-root runtime exports or renderer, desktop, app-entry, browser-tool,
          headless, or shared contract `ManagedRuntime.make` usage.
    - [ ] Public `Runtime` service and facade methods are exposed only when their schema-backed
          contracts, state ports, runtime-owned services, emitted invalidations/events, shutdown
          behavior, and `test:effect` coverage exist; public runtime groups own their product
          policy inside runtime services; app/bootstrap callbacks and adapters do not own runtime
          product policy.
          Contract-level unsupported domain/scope/capability inputs are allowed only when the
          method ledger names them and tests prove the service path is fully wired.
    - [ ] Runtime message submission owns canonical queued `RuntimeSubmittedMessage`
          serialization, prompt telemetry, idempotent queue insertion, and package tests.
    - [ ] Runtime queued-message abort owns target validation, queue-row cancellation, committed
          invalidation publication, and post-commit surface refresh through runtime state/event
          ports and focused package plus adapter tests.
    - [ ] Public `Runtime.messages.submit(...)` handles `delivery` intent after durable queue
          insertion by publishing committed invalidations, waking the targeted runtime queue when
          delivery is `enqueue-and-run`, and relying on runtime-owned queue claiming to call
          `@svvy/pi-adapter` through its service boundary for queued runtime-message-to-pi-message
          conversion.
    - [ ] Prompt queueing, command-triggered queue inserts, workflow task-agent turn starts,
          runtime-queued prompt handoff, approval request creation, auto-review resolution, user
          answer resolution, command wait/cancel/start transitions, open-approval cancellation, and
          session-wait clearing run inside `@svvy/runtime` over core-owned state ports implemented
          by `@svvy/state`, with committed after-commit publication exposed through the
          app-composed runtime facade.
    - [ ] Pi callback command projection for streamed tool-call arguments and tool-execution
          command lifecycle writes runs through the runtime-owned command/session lane using
          `RuntimeCommandStatePort` writes and committed after-commit publication, with prompt
          cleanup awaiting queued writes before clearing prompt runtime state.
    - [ ] Runtime owns accepted native-tool execution end to end: it creates the command envelope,
          invokes `@svvy/extensions` handlers for the loaded actor binding, applies returned
          `ExtensionRuntimeOperation` items, applies `runtime_effect` requests through state and
          package services, executes `execution_plan` values through approval, sandbox, subprocess,
          file-effect, stdin/stdout/stderr, and child-command lanes, publishes state after-commit
          notifications, wakes affected queues, and records terminal command facts.
    - [ ] Runtime routes every accepted native tool through one accepted-tool command lane:
          `exec_command` including model-facing `write_stdin(session_id)` continuation admission,
          `apply_patch`, `execute_typescript`, `list_extensions`, `load_extension`,
          `request_user_input`, `thread_start`, thread state/control tools, and generated
          extension-facade child commands. Runtime allocates or reuses the authoritative command
          envelope, consumes pi `tool_call.*` and `tool_execution.*` events as receipts for that
          command, invokes `@svvy/extensions` handlers, applies returned
          `ExtensionRuntimeOperation` items, executes `RuntimeEffectRequest` and
          `ExtensionExecutionPlan` values, publishes committed notifications, and settles terminal
          command facts.
    - [ ] Command authorship is singular: pi-adapter may normalize or synthesize
          `pi.tool_execution.started`, `pi.tool_execution.updated`, and
          `pi.tool_execution.finished`, but it never creates command records, writes command facts,
          invokes extension handlers, applies runtime effects, or publishes runtime notifications.
          Extension handlers never allocate command ids or mutate product state directly. Runtime is
          the only package that authors command lifecycle state.
    - [ ] `write_stdin` targets an existing runtime-owned continuable `exec_command` command by
          durable `CommandId`; it records ordered stdin receipts and updates continuation facts on
          that command session. It does not create a second command record, append transcript text,
          or bypass `Runtime.commands.writeStdin(...)` admission.
    - [ ] `list_extensions` executes as a read-only accepted native tool through the same runtime
          command lifecycle as other native tools, including accepted argument snapshots, command
          start/finish facts, active-runtime validation failures, and ordinary command projection.
    - [ ] `load_extension` binding refresh effects, `request_user_input` nonblocking delivery and
          blocking waits, thread-control tools, runtime-state tools, and workflow-task
          `runTaskAgent` bridge effects execute through runtime-owned operation services; native
          tool declarations, metadata, and handlers live in `@svvy/extensions`, and accepted-tool
          execution in `@svvy/runtime` owns state ports, handler-thread creation, queue mutation,
          and command terminalization.
    - [ ] Runtime facades expose only closed Promise/callback/`AsyncIterable` errors that decode as
          `RuntimeFacadeError`, including typed failures, defects, interruptions, shutdown, and
          disposed runtime calls.
    - [ ] Runtime event publication runs through a package-private ordered event bus lane that
          assigns app-runtime sequence, appends the replay ring before bounded non-blocking live
          fanout, converts committed invalidation descriptors into notifications, and exposes public
          subscriptions through scoped filtered per-subscriber queues rather than raw shared PubSub
          streams.
  - [ ] `@svvy/pi-adapter` owns pi session creation, prompt streaming, event conversion, model
        metadata reads, helper jobs, and pi message normalization, keeping public runtime contracts
        pi-free.
    - [ ] `@svvy/pi-adapter/messages` owns conversion from canonical
          `RuntimeSubmittedMessage` values into pi user messages, including attachment prompt
          signatures, image blocks, and snippet provenance, through pure adapter conversion helpers
          used by runtime/app bootstrap wiring and tests.
  - [ ] Keep pi custom-tool conversion inside `@svvy/pi-adapter` turn setup so public package
        boundaries expose only `@svvy/core` native-tool definitions, runtime event contracts, and
        renderer-safe result schemas; pi-native tool setup and event adaptation stay inside
        `@svvy/pi-adapter`.
    - [ ] `@svvy/pi-adapter` root exports only `PiAdapter` and layer factories. The
          `@svvy/pi-adapter/messages` subpath owns adapter conversion helpers for adapter wiring and
          tests only unless a boundary test promotes an exact additional use; neither public surface
          exposes a Promise facade, `AsyncIterable` facade, edge callback bridge, or pi-native
          session/tool/model object exports.
    - [ ] App/bootstrap imports no package-private pi-adapter internals.
    - [ ] Managed-session materialization is available only through the restricted public
          `@svvy/pi-adapter/session` subpath for approved app-bootstrap pi-session persistence
          wiring, with exact exported symbols and allowed consumers enforced by package-boundary
          tests.
    - [ ] Pi-adapter exposes no caller-provided runner surface: `@svvy/pi-adapter` exposes only session,
          turn, model, and helper-job service methods consumed by runtime-owned prompt execution
          services, and no public or restricted pi-adapter subpath accepts or preserves a
          caller-provided queue-dispatch runner, callback runner, Promise runner, prompt runner, or
          task-agent runner for turn dispatch.
    - [ ] `@svvy/pi-adapter` implements the full specified service surface for `sessions`, `turns`,
          `models`, and `helperJobs`; `@svvy/core` exports the matching `InterruptPiTurnInput`, pi
          session reference, model-list, title-result, reserved restore/fork history DTOs, and
          runtime-event contracts with package-boundary tests. The root `PiAdapter` service does not
          expose a `history` group until concrete adapter-owned history operations and tests exist.
    - [ ] `@svvy/pi-adapter` obtains provider credentials only through `ProviderAuthPort`, never reads
          ambient env, app auth stores, OS keychain, pi auth files, or pi ambient credentials
          directly, and maps missing, expired, and refresh-failed snapshots to the exact pi-adapter
          provider-auth error reasons for session, turn, model metadata, and helper-job operations.
    - [ ] `@svvy/pi-adapter` helper jobs such as title generation use operation-scoped pi handles,
          explicit runtime-prepared prompts, model/reasoning inputs, provider-auth snapshots,
          bounded timeouts, schema-validated results, and cleanup finalizers without borrowing the
          user surface session, active tools, transcript, UI state, or queue state.
    - [ ] `@svvy/pi-adapter` owns package-local normalization for every supported pi `AgentEvent`
          and nested assistant-message event in the exact `PiRuntimeEvent` table in
          `pi-adapter.spec.md`, preserves pi `contentIndex`, and fails closed on unknown events
          before runtime receives any pi-native object.
    - [ ] `@svvy/pi-adapter` synthesizes `pi.tool_execution.started`,
          `pi.tool_execution.updated`, and `pi.tool_execution.finished` around callback tools when
          pi does not emit native tool-execution events.
    - [ ] Runtime consumes `pi.tool_execution.updated` events from `PiAdapterTurnStream` by appending
          progress/output/diagnostic command events through `RuntimeCommandStatePort`, publishing
          bounded `command.changed` notifications, invalidating command inspector read models, and
          treating late updates after terminal command state as diagnostics or recovery work rather
          than command mutation.
  - [ ] `@svvy/extensions` owns generated actor-context construction, actor binding
        resolution/validation, native tool handlers, `svvyx` dispatch, generated-package
        production, and immutable workspace-link plan construction through `@svvy/core` contracts.
        `@svvy/runtime` schedules/applies link repair and commits generated facts through
        core-owned state ports implemented by `@svvy/state`.
    - [ ] Build both generated app-owned packages, `@svvyx/extensions` and `@svvyx/workflows`,
          through `@svvy/extensions` using `GeneratedPackageRootPort`, `.svvy-generated-package.json`
          evidence manifests, package status output, and declarative workspace-link repair plans;
          runtime applies those plans, records workspace-link facts through core-owned state ports,
          and publishes committed invalidations after state commit.
    - [ ] Store base actor prompts and builtin extension instructions as package-owned MDX/source
          assets under `@svvy/extensions`; keep reusable Workflows prompt assets in the app-global
          Workflows source library while `@svvy/extensions` validates, builds, and contributes their
          generated context/output. Generated context assembly never treats generated package roots,
          profile rows, or renderer code as prompt-body owners.
    - [ ] Generated package refresh writes to scoped temp roots and promotes staged generated
          outputs only after validation; implementation helpers for render/write/discovery remain
          package-private behind `Extensions.generatedPackages.refresh(...)` and
          `Extensions.generatedPackages.planWorkspaceLink(...)`.
    - [ ] `Extensions.svvyx.run(...)`, source edit open/save, dependency readiness, command schema
          generation, native-tool schema generation, and generated package output validation are
          service-backed package operations with contract tests. Extension handlers return
          model-facing results plus ordered `ExtensionRuntimeOperation` items only; runtime applies
          `runtime_effect` requests and `execution_plan` items through the parent command/session
          pipeline and records durable facts through state ports.
    - [ ] Extension handlers return `ExtensionHandlerResult` with
          `operations?: readonly ExtensionRuntimeOperation[]` as the only runtime-work field; core
          schemas, generated declarations, handlers, runtime application, and tests accept only
          wrapped `{ kind: "runtime_effect", request }` and `{ kind: "execution_plan", plan }`
          items.
    - [ ] Source-edit APIs use the flat `sourceKind`/`sourceId` contract, generated-package refresh is
          atomic and package-owned, `@svvy/extensions` returns immutable workspace-link plans,
          `@svvy/runtime` applies repair and records link facts, generated context cache ownership
          lives in `@svvy/extensions`/`@svvy/runtime`, and root exports expose only the canonical
          service/layer. Any non-Effect inspection surface requires a separately specified public
          subpath with exact methods and boundary tests before implementation.
    - [ ] MDX prompt and instruction assets compile into plain prompt text before generated
          `@svvyx/workflows` `Prompts.*` authoring exports or generated actor-context output is
          emitted; raw MDX source and frontmatter never appear in agent-facing prompt bodies or
          generated declarations.
    - [ ] Generated `@svvyx/workflows` and `@svvyx/extensions` declarations are exact, stable, and
          package-boundary tested, including pinned reasoning-effort unions, allowed imports only,
          no app/runtime/private implementation imports, no raw secret values or secret-store
          references, no source-checkout-relative paths, and no generated package metadata that
          exposes app-private implementation paths.
  - [ ] Execute Shell, Apply Patch file effects, Execute TypeScript runtime launches, and
        user-visible `svvyx` shell commands through `@svvy/runtime` command lifecycle using
        `@svvy/extensions` command plans/handlers, runtime-owned launch-policy acquisition through
        package-private `RuntimeLaunchPolicyService` over `@svvy/sandbox`, and scoped Effect
        subprocess services with fake process-spawner test layers. Extension dependency
        install/update admission requires a lifecycle-complete runtime-owned dependency-action API
        with exact schemas, state/package contracts, approval linkage, sandbox launch policy,
        subprocess lifetime, command facts, readiness refresh, public error mapping, and tests.
        `@svvy/extensions` returns ordered `ExtensionRuntimeOperation` items for
        runtime-owned work that needs subprocess, file, approval, sandbox, command-fact,
        child-command, or state effects; `@svvy/runtime` processes those items through
        `@svvy/sandbox`, `@svvy/state`, and scoped Effect subprocess services. Pure validation may
        remain inside `@svvy/extensions`.
  - [ ] Have runtime command/session lanes acquire scoped `SandboxLaunchFacts` through
        `RuntimeLaunchPolicyService`; managed facts carry sandbox-owned helper/profile artifacts
        for the owning subprocess scope, while full-access facts represent managed OS sandbox
        omission.
  - [ ] Source invalidation runs as Effect-scoped `@svvy/runtime` services with one app-global
        coordinator for Workflows and Extensions source roots plus one workspace coordinator per
        acquired workspace for external instruction candidates and discovered read-only host
        snippet Markdown sources. App/bootstrap starts, signals, reconciles, and closes coordinator
        handles only through `@svvy/runtime/source-invalidation-coordinator-adapter`; coordinator
        semantics remain package-private runtime services. Watcher events are hints into deterministic fingerprint scans,
        coordinator lifecycles use Effect `Clock`/`Schedule`/`Stream` timing with `@effect/vitest`
        `TestClock` schedule tests, app-global generated-package refresh runs once per app-level
        source/build change rather than once per workspace runtime scope, acquired workspaces run
        separate link repair after generated-package facts commit, unopened workspaces receive
        repair-needed facts plus recovery work, and DB-backed product writes such as agent settings,
        profile settings, and managed svvy snippets enter through committed `@svvy/state`
        after-commit descriptors rather than public raw invalidation descriptors.
    - [ ] Generated-context build, binding, and stale-surface persistence flow through
          `RuntimeActorExtensionBindingStatePort`, `RuntimeExtensionContextImpactStatePort`, and
          `RuntimeGeneratedPackageStatePort`, with runtime usage before prompt dispatch and focused
          state/runtime tests for read-only inspection, binding mutation, context-impact replay, and
          generated-package fact invalidations.
  - [ ] Implement workspace/surface queue dispatch, prompt locks, wakeups, scoped disposal, and
        semantic test receipts as Effect-native `@svvy/runtime` services.
  - [ ] Package code exposes Effect-native services composed once by app/bootstrap; package code does
        not create package-level `ManagedRuntime`s or rebuild layers per request. Only approved
        app/bootstrap facade adapters, named facade tests, and the named state facade harness may run
        effects through an explicitly supplied `ManagedRuntime`; package-internal runner exceptions
        remain limited to the exact pi-adapter callback bridge and source-invalidation coordinator
        adapter allowlists named by the Effect spec.
  - [ ] Package service/layer tests live under `packages/**/*.effect.test.ts`, run through
        `bun run test:effect` with `@effect/vitest`, and are included in `bun run check`;
        SQLite-backed `@svvy/state` tests remain in the Bun unit lane only while they directly or
        transitively depend on the active `bun:sqlite` adapter.
    - [ ] `@svvy/runtime` and `@svvy/extensions` service/layer tests use the Effect lane;
          `@svvy/state` service/layer tests use the Effect lane except SQLite-backed `bun:sqlite`
          tests; package-boundary guards reject `./effect.test-support`, manual runner symbols, and
          `bun:test` imports in Effect-lane files except where explicitly allowlisted.
    - [ ] Runner allowlists keep `@effect/vitest` and `effect/testing` imports confined to
          `*.effect.test.ts` files, keep SQLite-backed `@svvy/state` Bun-lane tests free of
          `ManagedRuntime.make` except the named state facade harness, allow state-local
          `runTestEffect` only for SQLite-backed state tests, keep ordinary package/app tests on
          approved sync-contract, facade, or fixture boundaries, and reject unlisted manual Effect
          runtime creation.
  - [ ] Focused Effect lifecycle tests cover shared layer memoization, local
        `Effect.provide(..., { local: true })` isolation exceptions, finalizer failure reporting,
        app-bootstrap readiness-failure disposal, task-agent bridge server lifetime, and
        resource-matrix coverage.
  - [ ] Enforce Effect architecture package-boundary gates with no unlisted manual runtime runners
        in tests, hoisted schema compiler calls, direct v4 Effect import paths, no package host
        globals such as `process.env`, `process.cwd()`, `node:os` path facts, `Date.now()`, or
        `Math.random()` in runtime logic, no unsafe public sync decoders, no package-public exports
        of runtime effect applier internals, and owner-allowlisted file-backed source mutations only.
    - [ ] Ensure only app bootstrap constructs the app-owned `ManagedRuntime`, and only
          app, desktop, browser-tool, headless, and test edges use approved facades or Effect test
          layers. Package native-tool execution paths stay Effect-native inside `@svvy/runtime`,
          invoking `@svvy/extensions` handlers and applying ordered `ExtensionRuntimeOperation`
          items through runtime-owned services.
    - [x] `createDesktopApp(input)` is the only `@svvy/desktop` root product
          bootstrap adapter value; root exports may include only type exports for renderer-safe
          desktop adapter, notification, and input contracts. App bootstrap injects prebuilt
          runtime/state/command facades plus desktop host adapters, and desktop never receives raw
          `ManagedRuntime`, Effect services, package-private ports, layer factories, SQLite, pi,
          sandbox, or generated-package handles. Commit(s): `21f6068d12`.
    - [ ] App bootstrap exposes exactly one healthy app-owned `ManagedRuntime` after
          `managedRuntime.context()` and runtime-owned startup readiness, exposes zero during
          startup/failure/retry/shutdown, and closes bridge delivery during runtime lifecycle
          restart; bridge delivery reopens only after the app-owned runtime reaches readiness.
    - [ ] App bootstrap, desktop bridge, browser-tool bridge, and headless entrypoints contain no
          manual Effect runtime execution exceptions outside approved bootstrap/test harnesses, do
          not import unapproved state internals, do not access package-private ports/layers
          directly, and reach state/runtime behavior only through the approved app-owned runtime
          facade plus injected state read/command facades. The only production state restricted
          subpath imports allowed in app bootstrap are the exact structured-session wiring imports
          named by `state.spec.md` and package-boundary tests.
    - [ ] `@svvy/pi-adapter` maps session/model resolution failures into typed adapter/core
          contract errors before they cross the package boundary, with Effect tests for unknown
          provider/model cases.
    - [ ] `@svvy/sandbox` root exports only `Sandbox`, `layer`, and approved sandbox service
          contracts; helper path resolution, helper argv construction, filesystem policy builders,
          direct launch builders, and helper-specific launch builders are package-private or
          test-only, while direct subprocess denial diagnostics are restricted to their exact
          app-edge diagnostics subpath.
    - [ ] Runtime-owned accepted native-tool execution consumes `RuntimeLaunchPolicyService` for
          launch-policy acquisition; only that package-private adapter calls
          `Sandbox.buildLaunchPolicy(...)`, and app/Bun tool edges do not synthesize sandbox policy
          from approval mode, network access, generated-output locations, temporary directories, or
          host facts.
    - [ ] `@svvy/desktop` public adapter types expose no raw `RuntimeEvent` renderer notification
          variant; app/bootstrap maps runtime events to renderer-safe invalidation, rebaseline,
          command, and shutdown notifications before desktop delivery.
    - [ ] Boundary tests cover exact Effect service ids, public subpath export ledgers, actual
          boundary-schema `Schema.optionalKey(...)` usage, exported sync decoder naming, canonical
          runtime root layer exports, generated-root resolution through `GeneratedPackageRootPort`,
          rejected package names across non-vendor docs/source/manifests, product-doc bans for
          repo-local shipped-architecture paths, Effect runner zones, exact root dependency pins for
          architecture-critical host packages, and the generated
          `docs/specs/package-architecture/core-public-symbol-index.generated.md` root-export
          coverage artifact.
      - [ ] Semantic `@svvy/core` public symbol contract coverage keeps the generated root-export
            index exact for every public export and owner tests or source annotations
            provide accepted examples, rejected examples, decode/encode helper coverage, parse
            options, and schema-specific boundary behavior for every schema-backed boundary contract;
            public branded ids either appear in the exact indexed set or stop being exported.
      - [ ] Export encoded DTO aliases and decode/encode helper quartets for every public schema-backed
            `@svvy/core` boundary contract whose wire, persistence, generated-package, bridge, or
            facade shape can differ from the decoded branded shape, including keeping
            `RuntimeClientSubmissionEncoded` indexed with `RuntimeClientSubmissionSchema`.
      - [ ] Generated-package boundary tests scan written generated package trees, not only
            representative renderer return values: every emitted runtime-value import specifier has
            matching `.svvy-generated-package.json` dependency evidence, every generated
            `@svvyx/extensions` and `@svvyx/workflows` file rejects forbidden `@svvy/*` value
            imports, forbidden `effect/*` / `@effect/*` imports, same-package bare self-imports, and
            any `@svvy/core` import outside the exact type-only bridge contracts named by
            `generated-packages.spec.md`; generated-package-link imports use
            `manifestDependency: "none-generated-package-link"` evidence.
      - [ ] Runtime facade boundary tests classify every `Runtime["Service"]` group/method as
            `facade-public` or `package-private`, compare the classification to
            `createRuntimeFacade(...)` object keys and nested group methods, and assert that
            task-agent bridge internals, raw `RuntimeEffectRequest` appliers, generated-package link
            repair internals, recovery internals, and source coordinators never appear on public
            facade groups.
      - [ ] Restricted `@svvy/state` subpath tests use symbol-level allowlists plus negative symbol
            sets for `@svvy/state/structured-session-state`,
            `@svvy/state/structured-session-adapters`, and
            `@svvy/state/generated-package-maintenance`: no SQL helpers, migration helpers, raw table
            helpers, transaction internals, repository helpers, or selector APIs are exported unless
            this spec names the exact bootstrap/test use and boundary ledger entry.
      - [ ] Effect adoption governance tests keep `packages/effect-adoption-manifest.ts` fresh
            against the installed `effect@4.0.0-beta.84` audit: every adopted runtime module/member is
            covered by installed-export audit evidence or an explicit source-gated runner policy,
            every manifest audit date matches the active Effect audit date, and failure messages
            require rerunning the installed-export audit lane before manifest edits land.
      - [ ] Every exported non-state `Context.Service`, `Runtime.layer`, package root `layer`, named
            package layer, and promoted Effect-owning service method has an owning `*.effect.test.ts`
            coverage reference or a named schema/pure-boundary exemption; SQLite-backed `@svvy/state`
            Bun-lane exceptions stay separate and explicit while the active adapter imports
            `bun:sqlite`.
    - [ ] Every mutating state-backed Effect port method returns
          `StateMutationResult<T> = { value: T; afterCommit: readonly StateInvalidationDescriptor[] }`,
          including app logs and methods that append, record, claim, release, mark, resolve, cancel,
          clear, ensure-by-writing, or persist state; public core/state port tests reject bare write
          return values and raw `*Json` state-port payload leaks where a structured contract exists.
    - [ ] `@svvy/state` root exports the specified decoded-config state layer, root-layer config
          contracts, named state-backed port layers, approved read/command facade factories
          including `createStateFacade(...)` and `createStateCommandsFacade(...)`,
          `StateReadModels`, and `StateCommands`; it does not export broad stores, repositories,
          transactions, SQL clients, migrations, structured-session-state stores, or table helpers.
      - [ ] Structured-session artifact selectors are pure over provided state records: missing
            backing-file status is mapped onto artifact records by `@svvy/state` storage code, and
            selector projection code does not import `node:fs` or call `existsSync`.
  - [ ] Renderer/shared code imports `@svvy/core` contracts for runtime-facing data while
        app-bootstrap-provided `@svvy/runtime` and `@svvy/state` facades perform runtime/state work,
        without pi-native message/session/model imports or direct pi `Agent` mutation.
    - [ ] Shared renderer contracts expose read-model request/response and live-patch DTOs instead
          of pi-native transcript snapshots, full workspace sync payloads, or
          `ConversationSurfaceSnapshot`, `SurfaceSyncMessage.snapshot`, or full session/surface
          push payloads.
    - [ ] Renderer chat state uses plain view models derived from state read models and ordered
          stream patches; it does not construct, mirror, mutate, or store pi `Agent` objects.
    - [ ] Renderer/shared roots reject pi-native package imports, `@svvy/extensions` values, and
          `@svvy/state/*` implementation subpaths; extension usage, session navigation, and
          transcript display come only from injected facades and state/core read-model DTOs.
    - [ ] Store base actor prompts and builtin instruction material as `@svvy/extensions` source
          assets, and keep profile settings, `@svvy/runtime`, `@svvy/state`, workspace session
          catalog wiring, and app prompt host entrypoints free of prompt-body source ownership.
  - [ ] Keep concrete native tool declarations, actor-specific metadata, actor slicing, projection
        metadata, and handler lookup in `@svvy/extensions`, leaving `@svvy/core` with pi-free
        native-tool declaration, invocation input, result, `RuntimeEffectRequest`, and schema
        shapes. Cover the package boundary and import through the public workspace package.
- [ ] `@svvy/extensions` exposes the package-spec service/layer boundary for registry reads, actor
      binding, generated context, native handler lookup, `svvyx` dispatch, dependency readiness,
      source build state, generated-package production, and builtin capability/source-record
      resolution, with root export, contract, and package-boundary tests for each method group.
  - [ ] Own native tool command projection metadata in `@svvy/extensions`, including actor
        availability, command visibility, argument snapshot policy, generic versus self-recorded
        execution command policy, and turn-decision projection; `@svvy/runtime` command/projection
        trackers consume that metadata instead of duplicating specialized tool-name lists.
  - [ ] `@svvy/core` owns schema-backed command facts, command events, queue payload/read-model
        contracts, provider/settings/generated-context/extension inventory contracts, sandbox policy
        snapshots, and pi-adapter port contracts. Public shared contracts do not carry pi-native
        transcript objects.
  - [ ] `@svvy/pi-adapter` owns pi-native session creation, raw pi event adaptation, model
        registry/auth metadata, title helper jobs, and forked-history reads behind its Effect
        service boundary.
  - [ ] Implement sequenced `@svvy/runtime` event publication over committed state changes and pi
        stream patches, then have app/bootstrap subscribe, sequence, gap-detect, and fan out
        renderer-safe invalidations or bounded surface stream patches to `@svvy/desktop` with
        read-model rebaseline.
  - [ ] `@svvy/state` owns prompt history, composer drafts, and surface transcript read models.
        Desktop/RPC payloads use `@svvy/core` schemas, public handler-surface identity, and
        renderer-safe read models; submit responses and snapshots never contain pi transcript
        objects or renderer `Agent` state.
  - [ ] Runtime source edits expose only methods backed by exact `@svvy/core` schemas,
        `@svvy/extensions` file operations, `@svvy/state` source-fact writes, runtime Effect
        methods, facade wiring, and package-boundary/contract tests. Public source-edit methods are
        the closed runtime-owned source operation set with file-backed writes performed by
        `@svvy/extensions`, DB/product-state source facts committed through `@svvy/state`, typed
        runtime invalidations emitted only from committed descriptors, and no generic source CRUD
        surface.
  - [ ] Runtime state, prompt, queue, extension, and command execution ownership lives in the
        package service graph, with `@svvy/desktop` consuming bootstrap-provided runtime/state
        facades through renderer bridge adapters.
- [ ] Drive prompt submission, queue claiming, turn execution, handler-thread lifecycle,
      request-input delivery, generated-package refresh scheduling, recovery, title jobs, command
      tracking, and runtime event publication through `@svvy/runtime`.
- [ ] Expose desktop, browser-tool, and headless automation facades over the single app-owned
      `ManagedRuntime` after startup readiness, with Promise/callback/`AsyncIterable` edges that
      validate payloads, keep shutdown/disposal outside facade ownership, and make desktop/browser/headless
      consumers refetch state read models only from app/bootstrap-prepared renderer-safe invalidations
      derived from runtime events.
- [ ] `@svvy/extensions` generates only app-owned generated authoring package files during refresh
      and returns immutable workspace-link plans only from the separate link-planning operation for
      `@svvyx/workflows` and `@svvyx/extensions`; `@svvy/runtime` applies link plans and records
      facts, and generated packages are not public `@svvy/*` packages, reusable SDKs, or
      `execute_typescript` runtime facades.

## 0. Source Invalidation

- [ ] `@svvy/runtime` owns one app-global source coordinator for Workflows and Extensions source,
      plus acquired-workspace source coordinators for workspace external instructions and discovered
      read-only host snippets. Runtime owns source coordination, after-commit notification
      publication, workspace-link repair, and unopened-workspace repair-needed/recovery work;
      app/bootstrap may create and close those coordinator handles only through the named
      `@svvy/runtime/source-invalidation-coordinator-adapter`;
      app-global generated-package refresh runs once per app-global source change rather than once
      per workspace runtime scope; acquired workspaces repair their own links after
      generated-package facts commit; `@svvy/extensions` owns source-derived build evidence and
      generated package production; `@svvy/state` commits source/build facts through core-owned
      ports.
- [x] Keep generated `@svvyx/workflows` output, generated `@svvyx/extensions` output,
      extension build directories, and workspace `.smithers/node_modules/@svvyx/*` links outside
      the watcher trigger set. Commit(s): `03bf43f69`
- [x] Refresh only affected generated-package and source-derived facts after source fingerprints change: `@svvy/extensions` rereads source and refreshes app-global `@svvyx/extensions` / dependent `@svvyx/workflows` outputs once per app-global batch, runtime commits facts and read-model notifications through state, and affected open surfaces become stale by generated-context fingerprint only. Commit(s): `03bf43f69`
- [x] Protect editable file-backed workflow-agent source drafts with shared source-version compare-and-swap saves, warning-state autosave controls, and explicit keep-editing, discard-local, and overwrite-external conflict actions. Commit(s): `33b91c0ca`
- [ ] Invalid or unreadable source records appear directly in the relevant read models with
      diagnostics, while the last ready generated output remains active.

## 1. Structured Session State

- [x] Define the structured session overlay contract above pi session data. Commit(s): `c432f4e`
- [x] Persist a minimal structured session overlay root above pi session data. Commit(s): `b510857`, `fff54d7`
- [x] Add `surfacePiSessionId` linkage on turns so orchestrator-surface and handler-thread turns use one model. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist handler-thread records with title, objective, objective state, backing pi session id, and durable thread linkage. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist artifact references independently from transcript parsing at thread and command scope. Commit(s): `fff54d7`
- [ ] Store artifacts under the configured artifact directory keyed by the owning durable
      `workspaceSessionId`, with mutable artifacts directly under
      `<artifactDir>/<workspaceSessionId>/`, immutable artifacts under
      `<artifactDir>/<workspaceSessionId>/immutable/`, exact stored filenames, immutable metadata,
      refreshed file-backed byte/digest facts, and no reliance on OS-level file flags for
      immutability.
  - [ ] `@svvy/runtime` owns package-private artifact byte materialization, deletion, digest
        calculation, staged-file cleanup, and artifact-materialization recovery services;
        `src/bun` and app-bootstrap code provide only primitive host/file/path adapters and never
        create artifact records, write artifact metadata, perform durable artifact mutations, or
        define artifact lifecycle policy.
- [x] Persist ordered update and conclusion episode records each time a handler thread reports to the orchestrator, while preserving earlier episodes for later follow-up turns. Commit(s): `d323012`
- [x] Persist session wait state as a frontier-level summary derived from surface, workflow, request-input, and runtime wait records. Commit(s): `fff54d7`, `f53c9b8`, `43a26cb`
- [x] Drive structured session state only from explicit runtime producers or tool events. Commit(s): `fff54d7`, `59fc34e`, `43a26cb`
- [x] Reconstruct workspace and session summaries from structured state on app load. Commit(s): `b510857`, `fff54d7`
- [ ] Complete live-tool projection coverage for durable command argument snapshots, stdin receipts,
      retained output artifacts, specialized native-tool arguments, patch previews, and
      approval-state updates.
  - [x] Wire durable `command.arg_snapshot` recovery into command rollups and command inspectors so
        reload surfaces incremental argument history. Commit(s): `a55a5655a4`.
  - [ ] Extend runtime-owned incremental projection to specialized tools: `execute_typescript`
        source, native-control objective/report/question arguments, in-progress `apply_patch`
        patch-preview updates, and approval-state live updates.
  - [x] Recover durable accepted `command.stdin` receipts into command rollups and command
        inspectors with explicit `stdin.mode`, `stdin.canAttemptWrite`, and ordered
        `stdin.acceptedWrites`, while keeping write admission authoritative in
        `Runtime.commands.writeStdin(...)`. Commit(s): `a55a5655a4`.
  - [x] Render the command-inspector stdin composer for running continuable `exec_command` records,
        submit through the renderer-safe command stdin action backed by
        `runtime.commands.writeStdin(...)`, show `accepted`, `stdin_closed`, `not_running`, and
        `already_terminal` results, and refetch the inspector after accepted writes without
        appending transcript text or calling the model-facing `write_stdin` tool. Commit(s):
        `a55a5655a4`.
  - [ ] Add retained immutable log artifacts for oversized command-family stdout/stderr through the
        package-private `@svvy/runtime` artifact materialization lane, link them to the source
        command through `RuntimeArtifactStatePort`, and keep retained stream text out of stored
        command facts and durable output events while preserving small-output event projection.

## 2. `execute_typescript`

- [x] `execute_typescript` has a runnable TypeScript runtime with compile or typecheck-before-run diagnostics and the adopted TypeScript input/output contract. Commit(s): `76cc8f3`, `b41e5e6`
- [x] Persist each attempted snippet as a file-backed artifact before execution, with SQLite metadata and path indexing. Commit(s): `76cc8f3`, `fff54d7`
- [x] Route top-level `execute_typescript`, direct `exec_command`, app-owned `svvyx ...`
      command-family dispatch, and `apply_patch` through the shared runtime approval-boundary path
      before execution, with submitted TypeScript source persisted before review and
      `approvalMode: "full-access"` omitting that boundary. Commit(s): `4413a2b4ab`
- [x] Connect the runtime approval-boundary seam to app-owned automatic review and actor-local user
      approval requests, with durable runtime approval records, approve/deny RPC/UI actions,
      cancelled-command settlement, and fail-closed automatic denial for unsafe requests. Commit(s):
      `4413a2b4ab`
- [x] `execute_typescript` supports composed scripted tasks through the adopted runtime contract. Commit(s): `76cc8f3`
- [x] `execute_typescript` records source artifacts and execution traces through the artifact/tracing pipeline. Commit(s): `76cc8f3`
- [x] Capture `execute_typescript` logs and nested command traces as artifacts and structured command records. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Keep thread orchestration, thread handling, extension loading, and request-user-input as small `svvy`-native control surfaces while Smithers workflow operations use official CLI commands through Shell. Commit(s): `a02bd48`
- [ ] `execute_typescript` generated facades cover the complete actor-local builtin facade surface.
  - [ ] Project loaded builtin app-owned facade `Run.StreamResponse` streaming responses and
        `Cta.run()` command executions through runtime-owned child command facts and tests once the
        product has the required child-command recording contract.
- [x] Expose Codex-like Shell and Apply Patch extensions, with `exec_command`, `write_stdin`, and `apply_patch` as the normal coding-agent work interface. Commit(s): `76cc8f3`, `29d8452`
- [x] Package an app-owned Codex-derived native sandbox helper that enforces managed macOS Seatbelt
      launches through `/usr/bin/sandbox-exec`, with `Read`/`Write`/`None` entries, most-specific
      path precedence, equal-specific `None > Write > Read` precedence, default read access,
      cwd/project-root writable roots, explicit writable roots, read-only subpaths, protected
      `.git`, `.agents`, and `.codex` metadata carveouts, network allow/deny, full-access sandbox
      omission, sandbox-denial reporting, and fail-closed helper setup, with ordered helper
      candidate declarations validated for allowed-root containment, platform/arch, regular
      executable status, and expected digest before launch facts are returned; the helper build
      emits `svvy-sandbox-helper.metadata.json` beside the binary with schema version, artifact name,
      platform, arch, and SHA-256 digest, app packaging includes that metadata beside the packaged
      helper, and the app/bootstrap `SandboxHelperCandidatesPort` provider derives ordered helper
      candidate declarations from packaged metadata without reading repo-root build outputs at
      runtime. Commit(s): `4413a2b4ab`
  - [x] Managed sandbox enforcement is carried by runtime-acquired `SandboxLaunchFacts`, enforced
        at the OS edge by the native helper, and produced by `@svvy/sandbox`; ordinary
        `exec_command` and `apply_patch` coverage exercises helper-backed enforcement together with
        approval, generated-output and artifact projection validation, command projection, and
        sandbox-denial facts.
        Commit(s): `4413a2b4ab`
  - [ ] Native helper enforcement covers svvy managed launch facts: symbolic roots such as `:root`,
        `:project_roots`, `:tmpdir`, and `:slash_tmp`, deny-read path and glob entries with
        fail-closed invalid-glob handling, normalized filesystem/network policy, executor-required
        runtime-readable roots, scoped helper/profile artifacts, and full-access omission represented
        only as `sandboxMode: "omitted_full_access"`. Generated TypeScript declarations may describe
        these contracts, but enforcement lives in the native helper and scoped sandbox launch facts.
  - [x] Agent Shell usage of `svvyx ...` command families uses the ordinary Shell `exec_command`
        contract to reach the real app-owned Incur CLI, with Shell approval, sandbox, command facts,
        output streaming, and projection behavior. Commit(s): `4413a2b4ab`
    - [x] Route app-owned Artifacts `svvyx artifacts create`, `inspect`, `list`, and `delete`
          through `@svvy/extensions` validation and ordered `ExtensionRuntimeOperation` items;
          `@svvy/runtime` applies those operations through package-private artifact file-effect
          services, records command facts, and commits metadata/lifecycle facts only through
          `RuntimeArtifactStatePort`; `src/bun`/CLI subprocess code remains parse/transport/host
          adapter wiring and owns no artifact byte materialization or state mutation semantics.
          Commit(s): `4413a2b4ab`
    - [x] Artifact byte materialization, deletion, digest, staged-file cleanup, and recovery live in
          package-private `@svvy/runtime` services; app-bootstrap keeps only primitive host
          adapters, CLI subprocess transport, facade wiring, and managed-runtime composition.
          Commit(s): `4413a2b4ab`
    - [x] Route `svvyx artifacts open` through the real app-owned CLI path, returning a declarative
          inspector-open intent recorded in command facts and consumed by `@svvy/desktop`. Commit(s):
          `4413a2b4ab`

    - [x] Route `svvyx workflows`, `svvyx extensions`, and user/runtime `svvyx <extension-id> ...`
          dispatch through the real app-owned `svvyx` CLI process with explicit app-owned writable
          roots, env/secret injection, generated-package change signals, and dependency-approval
          context. Commit(s): `4413a2b4ab`

  - [x] Preserve Codex approval/escalation flow: compute approval before sandbox selection; approval
        permits starting the action but does not imply unsandboxed execution; execpolicy allow
        omits sandboxing only when every parsed command segment is explicitly allowed; explicit
        escalation/full-access omits the sandbox only when policy permits it; denied-read
        restrictions keep execution sandboxed; sandbox denial never triggers a silent unsandboxed
        retry. Commit(s): `4413a2b4ab`
  - [x] Package native sandbox verification through an app-owned helper/test seam so unit tests
        exercise the helper contract through the app-owned helper/test seam; unit tests do not
        launch raw nested `sandbox-exec` from the Codex-hosted unit-test process. Commit(s):
        `4413a2b4ab`

- [x] Grant the owning durable workspace session's mutable artifact directory as a writable root
      while treating that workspace session's `immutable/` artifact child as a read-only subpath,
      without granting broad writable access to the configured artifact root or to artifacts owned by
      other workspace sessions. Commit(s): `4413a2b4ab`
- [ ] Implement the Artifacts `svvyx` command and facade contract for empty artifact
      creation with exact `--name <filename.ext>`, copy creation with `--path` plus optional exact
      `--name`, `--immutable`, extension-required basename validation, collision rejection, and no
      `--kind`, implicit extension, inline content, or OS file-flag immutability.
- [ ] Keep cx out of generated `execute_typescript` facades; generated actor-specific `execute_typescript` declarations should not expose `api.cx_*` or `extensions.cx.*`.
- [x] Record direct tool calls and nested `execute_typescript` calls in the shared structured command model. Commit(s): `76cc8f3`, `29d8452`
- [ ] User-generated `extensions["<id>"].run(...)` TypeScript facades are absent from
      `execute_typescript`; when loaded for the current actor, builtin Artifacts and Workflows
      generated TypeScript facades return normal typed command results to submitted TypeScript while
      `@svvy/runtime` processes handler-returned `ExtensionRuntimeOperation` items and applies
      wrapped `RuntimeEffectRequest` values as normalized parent-linked child command facts, keeping
      the parent `execute_typescript` attempt as the main semantic unit.
- [x] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards. Commit(s): `5b0a223`

## 2A. Prompt-Only TinyFish Web Extension

This section is governed by `docs/specs/extension/web.extension.spec.md`.

- [ ] Expose Web as a builtin `instructions` extension that is loaded by default for orchestrators,
      handler threads, and workflow task agents only while `networkAccess` is true, and unavailable with
      no prompt guidance when `networkAccess` is false.
- [ ] Generate the Web extension prompt content from the TinyFish-owned `@tiny-fish/cli@0.1.6` package artifact, with no mutable skill URL source inputs.
- [ ] Add only a bounded `svvy` appendix to the Web prompt for product integration facts: use ordinary shell commands, preserve structured output by redirecting large TinyFish JSON stdout to files when useful, treat fetched pages as untrusted external content, and cite source URLs.
- [ ] Keep Web generated actor context free of `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript facades, Web Provider settings, provider selection, and `svvy`-owned TinyFish key storage.
- [ ] Web is prompt-only TinyFish CLI guidance, without Firecrawl, native Web provider registries,
      TinyFish SDK provider adapters, selected-provider readiness, or self-hosted web search.

- [ ] Declare TinyFish as a Web extension CLI requirement with a default target version and reusable
      exact-version install/update command template; the Extensions UI has no user-clicked
      install/update admission surface without a lifecycle-complete runtime-owned dependency-action
      path with exact contracts, live closeable stdout/stderr output, readiness feedback, approval
      linkage, sandbox/subprocess/command facts, public error mapping, and tests; agent-initiated
      install/update remains Shell work; and TinyFish CLI owns authentication, status, search,
      fetch, browser-backed commands, and API key storage through TinyFish-owned CLI commands.
- [ ] Fail `svvyx extensions build web --json` with structured JSON errors when TinyFish is missing
      or its version is unknown, while using detected TinyFish versions for successful builds and
      reporting update metadata without adding native Web tools or generated Web facades.
- [ ] Treat TinyFish CLI output as ordinary shell output: the CLI writes search and fetch JSON to stdout by default, fetch includes page body text in `results[].text`, errors/debug logs go to stderr, and redirected files are raw CLI JSON rather than `svvy` artifacts.
- [ ] Add generated-context and extension-inventory tests proving Web is prompt-only, loaded by default
      for all adopted actor kinds only while `networkAccess` is true, unavailable when `networkAccess` is
      false, and absent from native tool declarations, loaded `svvyx` command guidance, generated TypeScript
      declarations, provider settings, and Firecrawl provider lists.

## 3. Turn Decisions And Delegation

- [x] Persist a per-turn top-level decision for orchestrator, handler-thread, and workflow task-agent attempt surfaces, using one shared model across routing and supervision. Commit(s): `d323012`
- [x] Persist turn targeting, surface turn creation, and command recording in one runtime flow. Commit(s): `fff54d7`, `f53c9b8`
- [x] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface. Commit(s): `f53c9b8`
- [x] Add `thread_start` as the orchestrator-side delegation primitive. Commit(s): `f53c9b8`
- [ ] Expose the resolved thread-control runtime surface and extension-owned prompt output: orchestrators get `thread_start({ threadGroupId?, threads })` with per-item `history` and `overrides`, `thread_followup({ activate? })`, `thread_list`, `thread_episodes`, and `thread_request_report`; handlers get `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`; agent-facing prompts and runtime tool declarations contain only that thread-control surface.
- [x] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread_start`. Commit(s): `d323012`
- [x] Re-enter orchestrator control from durable handler-thread episodes, using durable thread objective state plus the latest episode. Commit(s): `d323012`, `fdaf460`

## 4. Handler Threads

- [x] Create handler-thread surfaces with objective handoff and dedicated backing pi sessions. Commit(s): `f53c9b8`
- [x] Persist handler-thread objective state separately from handler activity, workflow activity, waits, and repair context, without flattening workflow failure or cancellation into thread objective conclusion. Commit(s): `f53c9b8`, `fdaf460`, `a02bd48`
- [ ] Present handler-thread transcript cards with separate objective, current activity, latest report, and count fields from structured read models.
- [x] Let handler threads receive direct user messages through the same surface model as the orchestrator. Commit(s): `f53c9b8`
- [x] Keep handler-thread clarification, waiting, and resume inside the handler-thread surface by default. Commit(s): `f53c9b8`
- [ ] Add runtime-level verification that handler-local command or Smithers failure can continue or rerun on the handler surface without an orchestrator turn unless the handler explicitly calls `thread_report`.
- [x] Keep handed-back handler threads directly interactive for follow-up chat without forcing a new thread. Commit(s): `ba5c3f0`
- [x] Let a concluded handler objective move back to active through explicit orchestrator re-engagement with `thread_followup({ activate: true })`, preserving handler and workflow activity as derived facts. Commit(s): `f53c9b8`, `a02bd48`
- [x] Preserve earlier thread episodes when the same thread later returns control again. Commit(s): `d323012`
- [x] Allow the orchestrator to inspect a handler thread on demand without making that the default reconciliation path. Commit(s): `ba5c3f0`
- [x] Make `thread_report` the explicit handler-thread episode and conclusion path so ordinary handler replies stay interactive and multi-turn. Commit(s): `fdaf460`
- [x] Load orchestrator, handler-thread, and workflow task-agent attempt instructions through pi's true `systemPrompt` channel before sending each real prompt-bearing message. Commit(s): `8a41d08`
- [x] Surface the active system prompt as expandable surface metadata while keeping committed conversation history in pi session history rather than role-labelled prompt reconstruction. Commit(s): `8a41d08`
- [x] Slice generated capability declarations by actor so the orchestrator prompt receives only orchestrator-callable tools while handler-thread prompts receive only handler-callable tools. Commit(s): `a02bd48`
- [x] Teach the orchestrator prompt that workflow actions normally require delegation into a handler thread, while Smithers guidance remains handler-thread prompt-only guidance. Commit(s): `a02bd48`
- [x] Teach handler-thread prompts that the orchestrator owns delegation and reconciliation while omitting orchestrator-only tool declarations such as `thread_start` unless nested delegation is explicitly adopted. Commit(s): `a02bd48`

## 5. Smithers CLI Boundary

This section is governed by `docs/specs/extension/smithers.extension.spec.md`.

- [x] Keep Smithers as a builtin prompt-only extension scoped to official CLI and authoring guidance
      for handler threads, with no native Smithers tools, generated TypeScript facades, or bundled app
      Smithers runtime dependencies. Commit(s): `673837a`, `118fd39c9f`.
- [x] Generate the Smithers instruction fragment from the Extension Managing-selected
      `smithers-orchestrator` documentation version while excluding GUI, Gateway, MCP, HTTP server,
      OpenTelemetry, DevTools, event-streaming, OpenAPI, Effect, and wrapper-oriented fragments that
      are not current `svvy` product surfaces. Commit(s): `c91f88d377`, `dcc79bb073`.
- [x] Keep the svvy Smithers boundary instruction focused on workspace `.smithers/`, official
      `bunx smithers-orchestrator ...` CLI usage through Shell, official Smithers CLI operations, and
      reusable svvy workflow assets as Workflows-extension material. Commit(s): `c91f88d377`,
      `a02bd48`.
- [x] Keep orchestrators aware that workflow action normally delegates into handler threads, while
      handler threads load by default Smithers prompt guidance and workflow task agents do not load by
      default Smithers. Commit(s): `a02bd48`, `673837a`.

## 6. Workflows Source, Build, And Generated Surface

This section is governed by `docs/specs/workflow-library.spec.md` and `docs/specs/extension/workflows.extension.spec.md`.

- [ ] Store app-global reusable Workflows source under `~/.config/svvy/workflows/agents`, `prompts`, `components`, and `workflows`, while generated `@svvyx/workflows` and `@svvyx/extensions` roots are app-owned generated output locations resolved through `GeneratedPackageRootPort`, not source-library children.
- [ ] Treat generated `@svvyx/workflows` and `@svvyx/extensions` output plus workspace `.smithers/node_modules/@svvyx/*` links as read-only plumbing outside the safe writable boundary; ordinary edits target source and then build.
- [ ] Generate `@svvyx/workflows` with only `Agents`, `Components`, `Prompts`, and `Workflows` root namespaces, and export `Agents.defineTaskAgent` plus generated authoring type `Agents.TaskAgentParametersSource` under `Agents`.
- [ ] Link `@svvyx/workflows` and generated `@svvyx/extensions` into each opened workspace's `.smithers/node_modules` without relying on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or source-checkout-relative paths.
- [ ] Generate `@svvyx/extensions` during the Workflows build path from workflow-task-safe builtin ids plus file/build-eligible user `svvyx` extensions that opt into workflow task-agent reference export generation, have approved dependencies, and have successful current source/build evidence; reject workflow-agent overrides for deleted, instruction-only, dependency-missing, or build-failed extension ids.
- [ ] `svvyx workflows list [--kind agent|prompt|component|workflow] --json` reports only mechanically available export identity and source/generated paths.
- [ ] `svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json` rejects overwrites by default and returns one model-facing command result plus ordered `ExtensionRuntimeOperation` items wrapping `generated_packages.refresh` runtime-effect requests after successful source writes.
- [ ] `svvyx workflows build --json` returns a model-facing result plus an ordered
      `generated_packages.refresh` runtime-effect request; `@svvy/runtime` applies that request,
      calls `@svvy/extensions` to build `@svvyx/extensions` and `@svvyx/workflows`, records
      generated-package facts through core-owned state ports implemented by `@svvy/state`, then
      schedules separate runtime-owned workspace-link repair service work after those facts commit.
  - [ ] Preflight app-owned user Extension source before Workflows source validation so invalid Extension build inputs and TypeScript-enabled `svvyx` extensions that cannot rebuild fail with Extension-specific diagnostics before `@svvyx/extensions` or `@svvyx/workflows` package writes.
  - [ ] Workflows build preflight requests Extension rebuild work through `@svvy/runtime`; `@svvy/extensions` produces rebuild evidence, and dependency/CLI-aware outcomes are available before workflow-agent extension usage overrides are accepted.
- [ ] `svvyx workflows models list --json` reads the same pi-normalized provider/model/auth/reasoning metadata used by the Agents pane, without a live completion request by default.
- [ ] Store reusable task-agent parameters as structured `.agent.json` source records that are bidirectionally synchronized with the Agents pane and generated as `Agents.*` exports.
- [ ] Save `--kind agent` by statically extracting namespace-qualified `Agents.defineTaskAgent(...)` parameter literals without executing arbitrary TypeScript; reject dynamic, unresolved, or root `defineTaskAgent(...)` inputs with structured diagnostics.
- [ ] Generated `@svvyx/workflows` task-agent clients validate bridge success responses before
      returning `RunTaskAgentResult` and fail malformed success JSON with a clear bridge error.
- [ ] The `runTaskAgent` bridge validates auth header shape, request/response body size limits,
      Smithers task-attempt identity, `workspaceSessionId`, `sourceCommandId`, and idempotency
      before queueing runtime-owned workflow-task-attempt work.

- [ ] Workflow task-agent execution enters runtime through a durable handler-owned queue row and
      the narrow generated `runTaskAgent` bridge path; app/bootstrap hosts only the command-scoped
      transport binding into the runtime-owned operation, exposes no arbitrary app, shell, settings,
      orchestrator, or workflow-control RPC, and does not duplicate Smithers workflow/run state.

## 8. Workspace Navigation, Live Surfaces, And Core Projection

This section is governed by `docs/specs/workspace-navigation-core-projection.spec.md`.

- [x] Drive the session sidebar entirely from durable workspace session summaries. Commit(s): `9a21f87`, `b0ee858`
- [x] Define the stored shape for pinned and archived sessions, including the default collapsed state for the single Archived group. Commit(s): `3855fe4`
- [x] Persist pinned and archived session state. Commit(s): `3855fe4`
- [x] Render pinned sessions at the top of the active session list. Commit(s): `3855fe4`
- [x] Render archived sessions inside one Archived group in the session sidebar. Commit(s): `3855fe4`
- [x] Persist the Archived group collapsed state per workspace. Commit(s): `3855fe4`
- [x] Add session row actions for pin, unpin, archive, and unarchive. Commit(s): `3855fe4`
- [ ] Keep durable unread state session-level with sidebar timestamp dots, focus-to-read clearing, and session row context-menu actions for mark read or unread, pin, rename, archive, and confirmed delete; pane unread treatment, when present, reads from the same session metadata.
- [x] Join session summaries, focused panel, and panel-to-surface bindings in one workspace-shell read model without depending on a global active surface. Commit(s): `9a21f87`, `b0ee858`
- [ ] Keep workspace summaries and live transcript patches as separate read-model/renderer-safe
      projection surfaces: workspace summaries come from `@svvy/state` read models, live transcript
      patches come from app/bootstrap-derived renderer-safe surface stream patches, and
      `@svvy/desktop` caches them only as non-authoritative view state.
- [ ] Render open live-surface registry state from state-backed read models plus
      app/bootstrap-derived renderer-safe invalidations keyed by `surfacePiSessionId`.
- [ ] Render each live surface from state-backed surface read models plus app/bootstrap-derived
      renderer-safe invalidations and bounded surface stream patches for prompt-lock, model,
      reasoning, and cancellation lifecycle changes.
- [x] Render handler-thread rows from structured state in the workspace shell while keeping lifecycle subtitles, active command summaries, running indicators, open-pane treatment, and compact context rails local to the owning row. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Show thread objective, objective state, and row-local derived blocked reason in panel-local thread views. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render the latest thread episode for an inspected thread while preserving earlier episodes in thread history. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render thread-linked artifacts before relying on transcript reconstruction. Commit(s): `3855fe4`
- [x] Restore focused panel, panel-to-surface bindings, and inspector selection after restart. Commit(s): `3855fe4`
  - [ ] Keep open workspaces as left-aligned, horizontally scrollable, draggable app-chrome tabs with durable user-defined tab order, compact icon controls, >0-only colored status count badges, a svvy-owned default workspace runtime scope when no user workspace tabs restore, current-tab `Open Workspace`, `New Tab` as a new default workspace tab over the shared default workspace runtime scope and selected durable layout slot, and `Open Workspace in New Tab` as picker-backed user workspace tab creation; duplicate same-cwd tabs are separate chrome views over the same `@svvy/runtime` workspace runtime scope, session navigation read models, durable workspace state, live surface registry, queues, threads, app logs, generated Workflows export read models projected from generated-package facts, and durable layout slots keyed by `(workspaceId, layoutId)`, while each tab stores only its selected active layout id.
- [ ] Route all workspace-scoped runtime/state facade requests and typed notifications through
      explicit `workspaceId`; process-global cwd, active workspace, focused tab, and active runtime
      are not routing authorities. Keep app-global settings and app-global Workflows source-library
      operations on separate app-global APIs; require explicit `workspaceId` only for
      workspace-affecting settings, generated agent-context projections, command context, and
      workspace package-link repair.

## 9. Command Palette And Quick Open

This section is governed by `docs/specs/command-palette.spec.md`.

- [x] Define the product-owned command/action registry shape, including stable ids, labels, aliases, categories, availability, shortcuts, and typed execution targets. Commit(s): `cb319ac`
- [x] Define the shared VS Code-style palette shell where `Cmd+Shift+P` opens with `>` prefilled and `Cmd+P` opens the same input without a prefix. Commit(s): `cb319ac`
- [x] Define `>` as the live command-mode prefix for session, surface, handler-thread, Workflows, Dockview panel, settings, Agents profile, and spec-backed product actions. Commit(s): `cb319ac`
- [x] Define unprefixed `Cmd+P` as the reserved file quick-open entry point until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist. Commit(s): `cb319ac`
- [x] Adopt `cmdk-sv` as the Svelte command palette UI primitive while keeping product routing and command semantics owned by `svvy`. Commit(s): `cb319ac`
- [x] Expose the command palette over the product action registry. Commit(s): `cb319ac`
- [x] Expose session creation, open/switch, pin, unpin, archive, and unarchive actions through the palette. Commit(s): `cb319ac`
- [x] Show unified `Open Session` results for orchestrator, handler-thread, and workflow task-agent projection categories with visible kind badges. Commit(s): `12d89d8`
- [x] Route unmatched non-empty command-mode text after `>` into a New orchestrator initial prompt through the normal orchestrator turn model. Commit(s): `cb319ac`
- [x] Add keyboard shortcut handling for `Cmd+Shift+P`, `Cmd+P`, Enter, and command-palette `Cmd+Enter` placement once Dockview layout exists. Commit(s): `cb319ac`
- [x] Add tests for shortcut dispatch, command matching, action routing, disabled or hidden availability, and unmatched prompt-session creation. Commit(s): `cb319ac`
- [ ] Keep a product-owned shortcut registry with stable action ids, labels, platform chords, compact and readable display strings, scopes, input-typing policy, and app-menu routing metadata, while command availability and palette result metadata stay on product action definitions.
- [ ] Use TanStack Hotkeys as the renderer shortcut dispatch primitive for palette, quick-open, sidebar app actions, dialog-local actions, pane placement, and focused-pane actions.

## 10. Pane Layout, Surface Ownership, And Expanded Surfaces

This section is governed by `docs/specs/pane-layout.spec.md`.

- [x] Add `dockview-core` as the workspace layout engine and mount one Dockview workbench instance from the Svelte renderer. Commit(s): `a55a5655a4`.
- [x] Build the Svelte renderer adapter for Dockview content, tabs, header actions, context menu items, tab-group chips, watermark, and unavailable-surface panels. Commit(s): `a55a5655a4`.
- [x] Add Settings as a Dockview-bindable pane target and renderer branch. Commit(s): `a55a5655a4`.
- [x] Persist Dockview serialized layout state plus svvy panel metadata, including panel-to-surface bindings, panel-local state, chrome state, restore state, and minimum panel policy. Commit(s): `a55a5655a4`.
- [x] Persist fixed workspace layout slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`, with the selected slot autosaved on pane changes and empty user-workspace slots rendered as muted but selectable controls pinned at the far right of workspace chrome; default workspace slots use the same persistence model, with an empty selected default-workspace slot seeded by exactly one `Open Workspace` pane. Commit(s): `a55a5655a4`.
- [x] Keep panel-to-surface bindings separate from live surface runtime state. Commit(s): `a55a5655a4`.
- [ ] Support Dockview split, splitter resize, close, tab placement, panel and group drag placement, root-edge placement, edge groups, floating groups, and popout groups through svvy placement commands.
  - [x] Preserve tab, root-edge, floating, and popout placement intent through renderer-local commands that submit durable Dockview layout and panel-binding updates to `@svvy/state`; the desktop/Dockview adapter consumes the resulting read models and applies Dockview placement options. Commit(s): `a55a5655a4`.
  - [x] Expose command-palette placement actions for the current pane's surface into left/right/above/below splits, left/right/top/bottom root edges, floating groups, and popouts through the desktop action registry over Dockview layout state; runtime owns only live surface attach/release lifecycle. Commit(s): `a55a5655a4`.
  - [x] Derive command-safe Dockview tab-group targets from serialized layout state and expose `pane.place-tab.<groupId>` placement commands through the desktop action registry over Dockview layout state. Commit(s): `a55a5655a4`.
  - [ ] Add explicit resize commands once the product has a stable command target-selection contract for Dockview-owned groups and splitters.
- [ ] Configure Dockview drag/drop overlays and `dndEdges`, with svvy policy enforced through `onWillShowOverlay`, `onWillDrop`, `onDidDrop`, and `onUnhandledDragOverEvent`.
- [x] Manage explicit open and close semantics for live surfaces independently from Dockview panel focus. Commit(s): `a55a5655a4`.
- [x] Allow the same interactive surface to be opened in more than one Dockview panel at once. Commit(s): `a55a5655a4`.
- [x] Keep one underlying live surface controller per `surfacePiSessionId` regardless of panel count. Commit(s): `a55a5655a4`.
- [x] Persist Dockview layout JSON, panel occupancy, panel-local state, tab-group state, edge-group state, floating/popout state, and panel metadata across app restart. Commit(s): `a55a5655a4`.
  - [x] Persist and restore static-pane tab, root-edge, floating, and popout placement metadata through the state-owned workspace layout slots. Commit(s): `a55a5655a4`.
  - [x] Restore mixed runtime layout state for serialized Dockview JSON, prompt and static pane bindings, focused panel id, panel-local scroll and density, and edge/floating/popout placement metadata. Commit(s): `a55a5655a4`.
  - [ ] Add mounted Dockview verification that `fromJSON` restores edge and floating groups while preserving svvy's saved focused panel state in the real Svelte adapter.
  - [ ] Verify mounted popout restore through a test harness lane that can observe startup popout
        windows directly, without relying on ordinary panel synchronization from the main window.
- [x] Restore the focused Dockview panel on app restart. Commit(s): `a55a5655a4`.
- [x] Show exact Dockview panel-location indicators in the sidebar for open surfaces, including tab, edge-group, floating, and popout locations. Commit(s): `a55a5655a4`.
- [x] Show a clear highlight for the currently focused Dockview panel surface. Commit(s): `a55a5655a4`.
- [x] Define the stored shape for compact thread surfaces inside the workspace shell. Commit(s): `a55a5655a4`.
- [ ] Render compact thread cards in the workspace shell timeline.
- [x] Open a selected handler-thread surface in a chosen Dockview panel as a fully interactive surface. Commit(s): `a55a5655a4`.
- [x] Keep duplicated panel views of the same surface synchronized while allowing independent scroll position. Commit(s): `a55a5655a4`.

## 11. Agents Pane And Agent Profiles

- [x] Define the stored shape for pi-backed agent profile settings used by orchestrator, handler, and workflow task-agent attempt surfaces. Commit(s): `8e19462`
- [x] Keep agent profiles separate from session-local extension loading so specialized handler guidance uses normal handler-thread execution plus loaded extensions. Commit(s): `2a5dbbe`
- [x] Seed initial app-wide values for the default orchestrator profile, the `threadHandler` profile, and internal title-naming settings. Commit(s): `8e19462`, `354db28`
- [x] Persist the app-wide agent profile defaults editing model. Commit(s): `8e19462`
- [x] Persist app-wide agent profile settings. Commit(s): `8e19462`
- [x] Create orchestrator sessions with profile-backed orchestrator selection. Commit(s): `8e19462`
- [x] Persist the orchestrator profile snapshot and prompt selection used by created sessions. Commit(s): `8e19462`
- [x] Persist per-session orchestrator profile overrides. Commit(s): `8e19462`
- [ ] Persist and deliver handler start history mode for delegated handler threads, defaulting `thread_start.threads[].history` to `isolated` and supporting explicit `forked` starts only for conservative continuity cases where the user asks for current conversation context, unresolved design nuance cannot be captured in durable files or a compact objective, or multiple approaches must start from the exact same conversational point.
- [ ] Persist handler creation-time extension-state overrides for delegated handler threads as partial overrides over the `threadHandler` profile.
- [x] Keep the Agents sidebar pane between Logs and Extensions, with orchestrator profiles plus the `threadHandler` special profile owned there instead of in General settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Drive the New orchestrator picker order, profile-specific command palette actions, and surface profile badges from Agents-pane orchestrator profile order. Commit(s): `2b97c46648`, `031510ba2b`
- [x] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Keep the `threadHandler` special profile available for delegated handler-thread surfaces. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Show the current focused-surface agent profile summary in pane chrome. Commit(s): `8e19462`
- [ ] Use TanStack Form for complex settings forms where renderer-local validation and save state are needed.
  - [ ] Provider API key entry and app-preference settings use TanStack Form with validation, dirty state, reset/cancel submit state, async save errors, and `@svvy/state`-normalized reset defaults.
  - [ ] Agent-profile and workflow-agent parameter editors use TanStack Form while preserving direct-save semantics, workflow-agent instruction autosave status inside the textarea, and pi-normalized provider/model/reasoning constraints.
  - [ ] Extension env editors cover editable non-secret overrides and secret writes/removals through app-owned UI with redacted async errors and `@svvy/extensions`-authoritative readiness refresh.
- [ ] Expose workflow-agent parameter records in the Agents pane through the same source used for `Agents.*` generated Workflows exports, with create, duplicate, user-delete, non-deletable default Explorer/Implementer/Reviewer records, source-file links, and the same expanded extension selection/order editor used by other agent profiles.
- [x] Keep Agents-pane profile and workflow-agent controls visually stable during transient save/autosave states, using save indicators and action-level guards instead of dimming unrelated row controls. Commit(s): 5de117401
- [ ] Workflow-agent parameter record implementation and tests use the documented handler guidance
      from `workflow-library.spec.md` and `workflows.extension.spec.md` without coupling shipped
      product workflow authoring to repo-root `workflows/`.

## 12. Session Titles

- [x] Define the stored title states for top-level sessions and handler threads. Commit(s): `b510857`, `fe53a3b`
- [x] Add internal pi-backed title-naming settings for one-shot top-level session naming. Commit(s): `354db28`
- [x] Seed the internal title-naming settings to `openai-codex`/`gpt-5.4-mini` with low reasoning effort and treat its settings prompt as the only naming instruction, without exposing title naming as a special profile. Commit(s): `354db28`
- [x] Run durable event-driven title generation as a one-shot naming job concurrently with the first real top-level user turn without waiting for the orchestrator response. Commit(s): `354db28`
- [x] Use the first live composer draft or first submitted user message as the provisional visible session title until the namer-generated title lands. Commit(s): `5378dcb`
- [x] Persist generated top-level session titles, title-generation lifecycle state, and the first-turn trigger so app restart cannot duplicate or lose title generation. Commit(s): `354db28`
- [x] Block manual session rename while a title-generation job is pending or running, then release the lock after success, failure, or cancellation. Commit(s): `354db28`
- [x] Freeze auto-titling after manual rename or after the first successful generated title. Commit(s): `354db28`
- [x] Generate handler-thread titles with the same internal title-naming settings used for top-level sessions, using the orchestrator-supplied `thread_start` objective as the naming input. Commit(s): `4d74c78`

## 13. Composer Mention Links

- [ ] Define the stored shape for composer file and folder mention links.
- [ ] Provide an `@` autocomplete picker over indexed workspace files and folders.
- [ ] Keep selected `@` mentions as normal inline composer text.
- [ ] Render picker, dropped, and pasted files as removable chip-only composer attachments without mutating textarea text.
- [ ] Store file, folder, and image attachments for composer and transcript rendering, pass attachment paths through tagged agent-facing metadata without visible transcript prose, send images to pi as image content blocks, and warn when model metadata does not list image input.
- [x] Save composer draft text and chip-only attachments live as durable surface state that survives closing the surface and app restart. Commit(s): `5378dcb`
- [ ] Serialize inline mentions into the outgoing user message as normal workspace path links.
- [ ] Render sent mentions in the transcript as actionable workspace links that reveal files, open folders, and visibly mark missing paths.
- [ ] Keep mentions agent-neutral: no prompt injection, no eager file reads, no folder expansion, and no special context-target resolution.

## 13A. Queued Surface Messages

This section is governed by `docs/specs/queued-messages.spec.md`.

- [ ] Persist durable surface queue items as structured surface-local product state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO queue position.
- [ ] When a composer submits to an active orchestrator or handler-thread surface, queue the message for that same surface instead of steering the current turn, interrupting tool work, starting a concurrent turn, or retargeting to the focused panel.
- [ ] Deliver queued messages as the next real pi user message after the owning surface prompt lock releases, creating a normal turn record and preserving prompt history as a single queue-time submission.
- [ ] Project blocked prompt-bearing queue items near the owning surface composer, including count, order, remove, restore-to-composer, and duplicated-panel consistency, while idle-surface prompt-bearing items first appear as queued work or active work after atomic claim.
- [ ] Project pre-turn delivery failures as queue-row-local failed items, with normal turns, queue restoration, and queue cancellation driven only by their own explicit state transitions.
- [ ] Restore queued messages after app restart without transcript inference and resume delivery only after the owning surface runtime and prompt lock state are reconstructed.
- [ ] Claim queued messages atomically through one package-private
      `RuntimeSurfaceQueueDispatcherService` lane per `surfacePiSessionId`; duplicated panes or
      tabs wake the same runtime-owned surface queue lane and cannot create duplicate queue drains,
      duplicate prompt starts, or app-owned dispatcher instances.
- [ ] Use separate durable queue insertion and dispatcher claim transitions for idle-surface sends, with UI state derived from authoritative queue and surface read models after app/bootstrap-prepared renderer-safe invalidations derived from runtime events.
- [x] Keep queued-message drag reorder previews local until drop, persist only final changed order, and skip no-op durable reorder writes. Commit(s): `98c73ecbb6`
- [x] Represent handler reports as durable episode records that schedule typed `thread_report` orchestrator reconciliation notifications; notification dismissal does not roll back the episode or return a handler tool error. Commit(s): 7739c2c824
- [x] Represent generated agent context refresh as fingerprinted runtime state, apply stale opted-in refreshes after queue claim and before prompt-bearing dispatch, and expose extension-changed/out-of-date recovery UI without renderer-visible context-refresh queue rows. Commit(s): 61ba639d6a
- [ ] Let committed user transcript messages enter composer edit mode with a visible selected-message indicator and a draft-replacement warning, then resend by moving the same pi surface back to the original message's parent state before continuing from the edited user message.

## 14. Agents, Extensions, And Generated Agent Context

This section is governed by `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`, `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/structured-session-state.spec.md`, `docs/specs/queued-messages.spec.md`, `docs/specs/extension/smithers.extension.spec.md`, and `docs/specs/extension/workflows.extension.spec.md`.

- [x] Define builtin extensions for Shell, Apply Patch, Execute TypeScript, Extension Loading, Extension Managing, cx, Smithers, Workflows, Web, Git, GitHub, External Instructions, Artifacts, and Request User Input with default usage states for each adopted agent family. Commit(s): `673837a`
- [x] Load base orchestrator, handler, and workflow-task guidance through builtin `base-*` instruction extensions, with orchestrators aware that workflow action normally delegates into handlers, handlers loaded by default with prompt-only Smithers guidance and Workflows source-library commands, and workflow task agents keeping Smithers, Workflows, and handler controls configured off by default but still configurable through profile overrides. Commit(s): `673837a`
- [x] Define available extensions as the on-demand product-knowledge and capability layer for specialized handler work. Commit(s): `2a5dbbe`
- [x] Render loaded and available extension bindings in surface metadata so users can see when specialized extensions are active. Commit(s): `2a5dbbe`
- [x] Store app-wide agent profiles, extension usage selections, generated agent-context aggregate references, extension context fingerprints, and app-global extension activation metadata. Commit(s): `118fd39c9f`
- [x] Keep an `Extensions` sidebar surface below `Agents`, with builtin, user, and external-instruction records that manage reusable prompt material and capabilities rather than exposing one raw system-prompt textarea. Commit(s): `118fd39c9f`
- [ ] Complete Extensions-pane editing, reset, fingerprinting, and row controls for builtin instruction-only base extensions (`base-common`, `base-orchestrator`, `base-handler`, and `base-workflow-task`).
- [x] Seed builtin extension records for base actor instructions, code navigation, prompt-only Smithers guidance, Workflows source-library commands, workflow task boundaries, Web, Git, GitHub, Artifacts, and Request User Input, with per-agent usage states, non-deletable builtin rows, app-global scope, and extension reset behavior. Commit(s): `118fd39c9f`
- [x] Render generated agent-context previews for orchestrator, handler, and workflow task-agent actors, linking loaded and available extension rows back to their extension records and showing generated prompt, `svvyx` guidance, native schemas, and TypeScript declaration previews. Commit(s): `118fd39c9f`
- [ ] Show tokenx-backed generated prompt token estimates in expanded Agents rows, with active extension rows showing aligned generated instruction estimates, available rows showing available-prompt estimates plus would-be loaded-prompt estimates in parentheses, Off rows omitting counts, expanded workflow-agent inline instruction rows showing live draft estimates beside their source file link, and the total actor prompt estimate visible beside reset controls while including the current workflow-agent inline instruction draft.
- [ ] Expose Extension Managing create, instruction lifecycle, revert, delete, snapshot, build,
      dependency-readiness, and env/secret behavior through `@svvy/extensions` Effect services,
      core-owned state ports, state command/read facades, and runtime-owned accepted-operation lanes
      without app-edge command modules owning source lifecycle, dependency facts, secret material, or
      generated-context invalidation semantics.
- [ ] Extension env/secret persistence and readiness access are owned by core-owned state ports plus
      app/bootstrap-supplied secret-store read/mutation layers; package-boundary tests forbid
      runtime, extensions, pi-adapter, sandbox, generated packages, renderer/shared modules,
      browser-tool bridges, headless bridges, and generic app-entry code from importing or decoding
      raw secret-intake schemas directly.
- [ ] Serve Extension Managing snapshot metadata, source/package restore evidence, and historical
      generated-context inspection through state read models and
      app/bootstrap facades without renderer/runtime rebuilding historical prompts from current
      source files.
- [ ] Route user `svvyx` dispatcher planning through `@svvy/extensions`; runtime owns command
      execution, approval/sandbox lanes, command facts, state commits, and invalidation publication.
- [ ] Project builtin extension CLI readiness into the Extensions pane from the same Extension Managing inspect/build readiness facts, including missing, unknown, available, detected/current/default/latest versions, update-available status, and read-only Shell install/update command guidance without renderer-side CLI probing or renderer-triggered admission.
- [ ] Project reversible Extension Managing change cards into the Extensions pane from the same lifecycle, usage, and delete change records used by `svvyx extensions revert <change-id> --json`, with UI-triggered reverts submitted through the bootstrap-provided runtime facade's Extension Managing revert path and refreshed from `@svvy/state` read models.
- [ ] Dispatch built user `svvyx` extensions through the runtime-owned Shell command lifecycle:
      `svvyx ...` resolves active build manifests through the `@svvy/extensions` svvyx dispatch
      service, validates installed dependency package artifacts, runs trusted Incur command
      implementations with invocation-local env, redacts secret output, records readiness or
      command-failure facts, and never treats extension usage state as a shell-level command block.

- [ ] Extract Incur command manifests during successful user `svvyx` extension builds, persist them in active build metadata, and reject malformed command manifests before runtime dispatch or generated declaration emission.
- [ ] Manage Extensions-pane source editing, default order, duplicate/delete/reset controls, draggable default ordering, inventory filters, customized builtin tags, composable editable minimal instructions, loaded source contributors, scripted instruction contributors with editable generator scripts plus read-only generated output, external instructions as read-only discovered sources, tooling sections for native tool schema, `svvyx` command schema, and generated `execute_typescript` facade declarations, file-backed instruction editing with conflict handling, per-contributor skip controls, add/remove/reorder loaded-source lifecycle, and app-owned trash for instruction files.
- [ ] Run builtin local-source reset builds through the Extension build path, surfacing successful or blocked build projections in reset output and command facts.
- [ ] Packaged app includes the app-owned `svvyx` executable and runs Workflows source-library
      commands through generated-package refresh: `@svvy/extensions` builds `@svvyx/extensions` and
      `@svvyx/workflows`, `@svvy/runtime` commits generated-package facts and schedules
      workspace-link repair, and no shipped path depends on repo-root `workflows/`.
- [ ] Project Extension Managing reversible lifecycle changes through state-backed read models and
      app/bootstrap-prepared renderer-safe invalidations: `@svvy/extensions` owns source/package lifecycle validation and
      evidence, `@svvy/runtime` applies accepted operations and publishes committed invalidations,
      `@svvy/state` owns lifecycle/change facts, and the Extensions pane renders revert actions from
      those read models without making transcripts or UI events authoritative lifecycle state.
- [ ] Route `thread_start` extension overrides and handler-side `load_extension` through generated agent context bindings while preserving durable loaded and available extension ids on each affected surface.

## 14A. Ambient Agent Resources

This section is governed by `docs/specs/ambient-agent-resources-baseline.spec.md`.

- [ ] Add provider-neutral Ambient Agent Resources settings that default behavior-changing coding-agent host resources off, preserve visible runtime standards, and persist user-scoped host, workspace, target agent/profile, category, and source enablement records for callable capabilities, extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, and execution-policy resources.
  - [ ] Persist the disabled-by-default category ledger without letting that ledger affect prompts, tools, commands, UI, provider/auth behavior, or execution policy until the full enablement model exists.
  - [ ] Persist normalized host, source, app/workspace scope, category, and actor/profile enablement records for ambient resources without letting those records affect runtime behavior.
  - [ ] Add a pure resolved-binding helper that returns enabled ambient candidates only when category, source, scope, actor, and profile all match.
- [ ] Implement the baseline `@svvy/pi-adapter` so orchestrator, handler-thread, and workflow task-agent sessions deliver caller-provided `systemPromptBinding` values through pi's real `systemPrompt` channel, ignore `SYSTEM.md`/`APPEND_SYSTEM.md`, and keep behavior-changing ambient extensions, skills, prompt templates, themes, package resources, slash commands, hooks, provider adapters, and related settings disabled until enabled through exact category/source/workspace/profile contracts.
  - [ ] Create managed pi actor sessions with default-deny resource loading, caller-provided system prompts, empty agent files and append prompts, no host extensions/skills/prompt templates/themes/additional paths/factories, suppressed pi built-in tools, svvy-owned custom tools only, disabled prompt-template expansion, and no ambient `extendResources()` calls.
  - [ ] Discover same-directory `AGENTS.md` and `CLAUDE.md` as visible external instruction records, with `AGENTS.md` enabled by default when present and lone `CLAUDE.md` files enabled by default.
  - [ ] Implement `@svvy/state` persistence and Settings controls for external-instruction per-file enablement, actor selection, default-off builtin global roots, custom global roots, read-status visibility, and external-editor actions.
  - [ ] Project external-instruction records into the Extensions pane's distinct read-only External Instructions category with source group, path, read status, content, hash, per-file enablement, actor controls, Extension Managing inspect metadata, live stale prompt-binding updates, and external-editor actions.
  - [ ] Connect enabled ambient resources to runtime loading only after category-specific host/source/workspace/profile contracts exist.
- [ ] Reflect enabled ambient callable resources in actor-specific generated API declarations, enabled prompt-affecting resources in generated agent context previews and agent context fingerprints, and enabled command resources in product command routing without hidden tools or invisible prompt mutation.
  - [ ] Add resolved enabled ambient callable-resource bindings to actor-specific generated API declarations.
  - [ ] Add resolved enabled ambient prompt-resource generated previews/fingerprints and resolved ambient command-resource product routing.

## 14B. Snippets Prompt Macros

This section is governed by `docs/specs/snippets.spec.md`.

No remaining Snippets implementation gap is tracked in this progress file. Current Snippets product
behavior is defined by `docs/specs/snippets.spec.md`, `docs/features.ts`, and the accepted checklist
rows for managed/discovered Snippets, composer insertion, provenance, and host expansion disabling.

## 16. Recovery And Test Coverage

Workspace-runtime restart and crash recovery are governed by `docs/specs/workspace-runtime-recovery.spec.md`.

- [x] Restore multiple open surfaces and panel bindings from durable state during restart or resume. Commit(s): `7f84f06`
- [ ] Complete one `@svvy/runtime` workspace-runtime recovery coordinator with durable runtime recovery rows, transactional claims, leases, not-before/next-attempt timestamps, idempotency keys, per-surface queue, thread report notification, report request recovery, typed queued initial handler starts, title job recovery, Workflows generated-package refresh, separate workspace-link repair, runtime-published recovery notifications, and recovery app-log facts committed through `@svvy/state`.
- [ ] Complete request-input timer recovery semantics: paused blocking timers survive shutdown/restart
      without reforking timeout fibers, resume commits a new persisted deadline from stored
      remaining duration before starting a new process-local timer, and startup recovery only
      completes or reforks waits after reading durable open/terminal request and command facts.
- [x] Restore request-input clarification records and answerable waiting state after app restart. Commit(s): `7f84f06`
- [x] Restore thread report notifications and per-surface prompt-lock state after app restart. Commit(s): `7f84f06`
- [x] Add integration tests that exercise the real pi-backed runtime seam for direct work. Commit(s): `b0ee858`
- [x] Expand integration coverage to pi-backed handler-thread delegation and prompt-only Smithers CLI guidance. Commit(s): `f8557d9`, `b0ee858`, `55963d9`, `097ae47`
- [x] Add integration tests that exercise restart and resume behavior across workspace state, live surface state, and panel bindings. Commit(s): `7f84f06`

## 17. Context Budget Observability

This section is governed by `docs/specs/context-budget-observability.spec.md`.

- [x] Define the context-budget metric as an explicit percentage of the active model's max context for orchestrator surfaces, handler-thread surfaces, and workflow task-agent attempts. Commit(s): `8d3e362`
- [x] Define neutral, orange, and red thresholds for that metric: neutral below 40%, orange from 40% through 59%, and red from 60%, with orange marking the conservative context-degradation warning band and red marking the zone where summarization, handoff, or a fresh surface should be considered. Commit(s): `8d3e362`
- [x] Define focused-surface context-bar placement below the composer for orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Render the focused-surface context bar beneath the text input for orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Define compact bottom-edge context indicators for open unfocused orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Render bottom-edge context indicators on open unfocused orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Render context bars on focused handler-thread panes and workflow task-agent attempt summaries. Commit(s): `8d3e362`

## 18. Workflows Library Surface

This section is governed by `docs/specs/workflow-library.spec.md`.

No remaining Workflows pane implementation gap is tracked in this progress file. Current Workflows
pane behavior is defined by `docs/specs/workflow-library.spec.md`, `docs/features.ts`, and the
accepted checklist rows for read-only generated-package visibility, namespace exports, Agents-pane
navigation, refresh behavior, and absence of run/edit/delete controls.

## 19. App Logs Surface

This section is governed by `docs/specs/app-logs.spec.md`.

- [x] Provide app-log read/write state backed by `@svvy/state` SQLite persistence with structured debug, info, warn, and error entries, monotonic sequence numbers, unread counts, seen state, bounded retention, workspace/app scoping where applicable, and secret redaction. Commit(s): `dab04ac`.
- [x] Expose app-log read, summary, and read-state commands through bootstrap-provided state
      read/command facades; app/bootstrap fans out committed read-model invalidations and may send
      optional `AppLogUpdateMessage` live-pane optimizations, while `@svvy/state` read models remain
      authoritative. Commit(s): `dab04ac`.
- [x] Route production product observability through one app logger without depending on Electrobun browser-tools telemetry. Commit(s): `dab04ac`.
- [x] Emit targeted app logs for app lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers CLI guidance, Workflows build validation, direct tools, `execute_typescript`, artifacts, external editor handoff, and renderer bridge issues. Commit(s): `dab04ac`.
- [x] Add a `Logs` sidebar button directly above the workflow library entry with compact action-worthy unread badges for warning and error app logs, without surfacing info-only unread logs as sidebar badges. Commit(s): `dab04ac`.
- [x] Render a dense app logs pane with level filters, grouped source filtering, search, viewport-based read marking during unfiltered browsing, expandable details, stack traces, and links to related sessions, threads, commands, and artifacts where available. Commit(s): `dab04ac`.
- [x] Render the app logs row list with TanStack Virtual, preserving variable-height expanded rows, stable row identity, persisted scroll position during live updates, older-page loading, and the explicit `New logs` affordance across filtering, search, expansion, and live updates. Commit(s): `ed7e6ea88e`.
- [ ] Add representative mounted/integration coverage for the app logs pane, sidebar badges, and live-update read model.
