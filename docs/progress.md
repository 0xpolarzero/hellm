# Progress

Incremental roadmap toward the shipped PRD.

How to use this file:

- Keep items small enough to land in a focused PR.
- Treat this file as a roadmap and progress tracker.
- Prefer adding new items next to the closest related step instead of appending unrelated backlog at the bottom.
- Keep sections ordered by dependency: durable facts and execution before projection surfaces that depend on them.
- When an item is done, change `[ ]` to `[x]` and append the landing commit hash or hashes.
- Write each item as the capability that should exist or now exists.
- When the resolved design changes, rewrite affected items to the new steady-state plan.
- If an item starts reading like a subsystem instead of a step, split it before implementation.
- For any big lift or unclear design, add a POC step immediately before the production implementation step.
- Use POC steps to validate shape, constraints, and UX without prematurely locking the final architecture.

## Current Baseline

- [x] Bootstrap the Electrobun desktop app as `@svvy/desktop` over bootstrap-provided
      `@svvy/runtime` and `@svvy/state` facades, with `@svvy/pi-adapter` owned below runtime.
      Commit(s): `c118be7`
- [x] Add provider auth/settings support with local key storage and OAuth-backed access. Commit(s): `c118be7`, `6d757dc`
- [x] Add the artifact projection panel in the desktop workbench. Commit(s): `1d9bc05`, `6d757dc`
- [x] Add workspace-scoped prompt history recall in the composer. Commit(s): `cb1b7f1`
- [x] Add multi-session workspace navigation and session switching/resume support. Commit(s): `b22a0c6`, `df1a7df`
- [x] Feed static workspace panes from renderer-local non-authoritative warm read-model caches backed by `@svvy/state` read models, with app-global state shared across workspace tabs, workspace projections keyed by workspace id, background refresh at runtime boundaries, and immediate pane updates when snapshots change. Commit(s): pending local changes

## 0A. Effect Package Architecture

- [ ] Publish the shared `@svvy/core` package contract with branded ids, Effect Schema contracts,
      tagged domain errors, typed runtime notification and stream-event contract shapes, command
      envelopes, declarative `RuntimeEffectRequest` schemas, schema-backed generated-package
      fact/metadata contracts, and cross-package port data contracts.
  - [ ] Complete package contract appendices for every public DTO and service method that crosses a
        package boundary: exported symbol, owning schema, backing owner, accepted JSON example,
        rejected JSON example, facade/error mapping, and focused boundary tests. Extension service
        DTOs, state read-model results, command fact payloads, recovery payloads, workflow
        task-agent bridge payloads, generated-package helper contracts, and artifact inputs must not
        rely on ellipses, prose-only fields, or duplicated preview data.
    - [x] Define exact target contracts for the P0 runtime-facing state-port DTOs used by queue
          lifecycle, approval requests, and session wait projection, including durable record
          shapes, transition inputs, owner/lease fields, and after-commit invalidation behavior.
          Commit(s): pending local changes
    - [x] Define exact target contracts for runtime-facing handler episode records, handler-thread
          read models, recovery work rows/payloads/leases, extension state ports, and public
          `@svvy/extensions` registry/binding/native-tool service DTOs, including explicit
          app-versus-workspace recovery scope and no omitted-target thread episode reads.
          Commit(s): pending local changes
    - [x] The package architecture contract uses the exact Effect v4 beta.84 surface for schema
          decoders/assertions, schema representation imports, SQL adoption permissions,
          core-owned data-only port tags, extension source-edit method ledgers, builtin source
          materialization results, and extension-facing state-port read/evidence-return authority.
          Commit(s):
          pending local changes
- [ ] Expose the non-UI package graph as Effect v4 service/layer packages with scoped resources,
      typed errors, streams, schedules, queues, subprocess boundaries, and `@effect/vitest` test
      layers.
  - [ ] Keep the installed Effect stack exact and coherent across the root app and every `@svvy/*`
        package: `effect`, adopted `@effect/platform-*`, and `@effect/vitest` move together in
        manifests, `bun.lock`, package-boundary expectations, and local reference usage before
        product code imports APIs from a newer reference snapshot. If a future Effect SQL adoption
        is approved, the adopted `@effect/sql-*` packages must join the same coherent version and
        boundary-test rule in the same architecture change. Root devDependencies own `vitest` and
        `@effect/vitest`, while package-local devDependencies remain forbidden.
    - [x] `layerRuntimeBunPlatform` provides the adopted Bun/Electrobun abstract platform subset:
          `FileSystem.FileSystem`, `Path.Path`, and `Crypto.Crypto` through
          `BunFileSystem.layer`, `BunPath.layer`, and installed-verified `BunCrypto.layer`;
          package-boundary tests keep every other Bun platform module out of product code.
          Commit(s): pending local changes
    - [ ] The Effect stack is coherent across manifests, `bun.lock`, local references, and
          package-boundary checks: every adopted `effect`, `@effect/platform-*`, and
          `@effect/vitest` package resolves to one compatible version set, and any version change
          moves the whole adopted stack together.
    - [ ] `SVVY-EFFECT-001` enforces the installed Effect stack before typecheck/build: every
          referenced Effect API either typechecks in covered source against the installed package
          set or has a dated installed-export audit row, and local reference snapshots never bypass
          the manifest/lockfile source of truth.
  - [ ] Data-only core-owned port tags use the Effect v4 function-syntax
        `Context.Service<PortIdentifier, PortService>("@svvy/core/...")` pattern, preserve root
        export names, and keep Effect environment requirements type-distinct from structural
        `*Service` implementation shapes.
    - [x] `ExtensionStatePort` uses function-syntax
          `Context.Service<ExtensionStatePort, ExtensionStatePortService>`, generated-package
          refresh requirements use `ExtensionStatePort` as the Effect environment type, and
          providers implement the `ExtensionStatePortService` shape. Commit(s): pending local
          changes
    - [x] `AppLogWritePort` uses function-syntax
          `Context.Service<AppLogWritePort, AppLogWritePortService>` and the state-owned provider
          returns the `AppLogWritePortService` shape before installing it through the core-owned
          tag. Commit(s): pending local changes
    - [x] `SandboxPolicySource` uses function-syntax
          `Context.Service<SandboxPolicySource, SandboxPolicySourceService>`, the state-owned
          provider returns the `SandboxPolicySourceService` shape, and `@svvy/sandbox` consumes that
          shape only after yielding the core-owned tag from its layer. Commit(s): pending local
          changes
    - [x] `ProviderAuthPort`, `SecretStorePort`, `PiSessionReferencePort`, and
          `PiRuntimePathsPort` use function-syntax `Context.Service<PortIdentifier, PortService>`
          tags while callers and tests keep providing plain `*Service` objects through the
          core-owned dependency identities. Commit(s): pending local changes
    - [x] Runtime state ports use function-syntax
          `Context.Service<PortIdentifier, PortService>` tags for queue, turn, command, approval,
          wait, artifact, request-input, generated-package, actor-extension-binding,
          extension-context-impact, recovery, episode, thread, and read-model state dependencies;
          `@svvy/state` providers return the matching plain `*Service` shapes and install them
          through the core-owned tags. Commit(s): pending local changes
    - [x] Package-local data-only host/config ports use the same function-syntax
          `Context.Service<PortIdentifier, PortService>` shape only where the owning package spec
          and boundary tests name the port: `ExtensionSourceRootsPort`, `GeneratedPackageRootPort`,
          `WorkspaceSourceLinkPort`, `SandboxHelperCandidatesPort`, and `HostProcessReferencePort`.
          Commit(s): pending local changes
  - [x] Package architecture specs state the target Effect v4 composition invariants: state read
        services are Effect-native, state command facades receive a bootstrap-created runtime
        publication sink, named state port layers project from one acquired state layer,
        `@svvy/pi-adapter` never creates or receives a package-owned `ManagedRuntime` for pi
        callbacks, and desktop bootstrap owns the single app runtime through the
        `createDesktopApp(...)` start/dispose contract. Commit(s): pending local changes
  - [ ] Add package-boundary checks for exact public subpath exports, allowed Effect module imports
        per package, `@effect/vitest` service-test lanes and root dependency placement, no public
        or renderer, desktop, app-entry, browser-tool, headless, or shared contract pi-native leaks
        outside `@svvy/pi-adapter`, no public
        pi-adapter internal session exports, no public boundary error/schema codec gaps, no
        `Schema.optional(...)` public optional fields without explicit undefined-valued exceptions,
        no generated `@svvyx/workflows`/`@svvyx/extensions` manifest or import-policy drift, and no
        manual `ManagedRuntime.make` / `Effect.run*` outside approved facade, bootstrap, and
        integration harness files.
  - [x] Expose initial public package entrypoints and package-boundary coverage for
        `@svvy/core`, `@svvy/state`, `@svvy/pi-adapter`, and `@svvy/sandbox`, with remaining target
        boundaries tracked as explicit unchecked capability items below: private state/app-log
        internals and private pi-adapter session internals. Commit(s): pending local changes
  - [ ] Expose `@svvy/state` `layer(input)`, approved read facades, command facades, and named
        state-backed implementations for core port service tags, while keeping repositories, SQL
        helpers, migration helpers, transaction helpers, table helpers, and SQLite implementation
        details private to `@svvy/state`.
    - [ ] SQLite persistence remains package-private to `@svvy/state`: repositories, setup,
          migrations, SQL clients, SQLite handles, transaction helpers, and table helpers do not
          cross the package boundary. Any Effect SQL adoption lands as one coherent state-package
          adoption record covering manifests, `bun.lock`, private setup/migration layers, repository
          implementation, and package-boundary checks.
    - [x] Expose an initial state-owned `SandboxPolicySource` implementation and layer that returns
          immutable core sandbox policy snapshots for workspace launches, app-generated package
          builds, workspace generated-package link repair, and extension dependency roots from
          explicit state-owned workspace/settings/root facts. Commit(s): pending local changes
    - [ ] Hide all structured store classes and DTOs, broad structured-state mutation surfaces, raw
          repository/store helpers, and broad state subpaths behind package-private or test-only
          boundaries so public consumers use only `layer(input)`, approved read facades, command
          facades, and core-owned port layers.
    - [x] Expose a state-owned `AppLogWritePort` layer that validates the core append schema,
          persists redacted app-log rows through `@svvy/state`, preserves the supplied occurrence
          timestamp, maps related product ids, and returns `StateMutationResult` app-log
          invalidations. Commit(s): pending local changes
    - [x] Expose the initial `@svvy/state` app-log read/command facade slice under the final
          `layer(input)`, `createStateFacade(managedRuntime)`, `StateReadModels`,
          `StateCommands`, and `createStateCommandsFacade(managedRuntime, { invalidationSink })`
          names, with typed `StateFacadeError` failures, core-schema validation for app-log read
          commands, idempotent command receipts, and committed `appLogs` invalidations. Commit(s):
          pending local changes
    - [x] State facade calls pass post-admission abort signals into the caller-owned
          `ManagedRuntime` runner so underlying fibers interrupt and release resources; pre-aborted
          calls fail as `reason: "aborted"` and interrupted exits map to `reason: "interrupted"`.
          Commit(s): pending local changes
    - [ ] Keep all app-log persistence access behind `AppLogWritePort`, approved read/command
          facades, and package-private or test-only helpers; root exports do not expose
          `AppLogFacade`, `AppLogger`, app-log stores, or standalone app-log construction helpers.
      - [x] `@svvy/state` root does not export app-log logger helpers or standalone redaction
            helpers; app/bootstrap host-adapter code owns its app-local logger and
            execute-typescript output redaction while state keeps persistence redaction private.
            Commit(s): pending local changes
    - [ ] Complete `createStateCommandsFacade(managedRuntime, { invalidationSink })` across every
          product state command group with idempotent command receipts, committed `afterCommit`
          descriptor collection, and a bootstrap-created runtime publication sink handoff before
          Promise resolution.
    - [ ] Ensure every runtime-facing state mutation returns a complete `StateMutationResult`
          descriptor set for the read models it changes, including command inspectors, handler
          thread inspectors, workflow task attempt inspectors, request-input inspectors,
          generated-package/readiness views, workspace chrome/layout, app settings, and app logs.
      - [x] Generated-package build, failure, refresh-needed, manifest reconciliation, and
            workspace-link status writes return app read-model invalidations for
            `workflowsGenerated` or `extensions` from the committed state-port result. Commit(s):
            pending local changes
  - [ ] Expose `Sandbox` plus the root `@svvy/sandbox` `layer` for immutable policy snapshots,
        helper lookup, launch constraints, and denial classification.
    - [x] Align core sandbox launch scope/kind schemas with the sandbox spec, including
          generated-package workspace-link repair, and make sandbox launch policy build only from
          immutable state-resolved policy snapshots plus typed host-support ports. Commit(s):
          pending local changes
    - [x] Acquire `SandboxPolicySource`, `SandboxHelperCandidatesPort`, and
          `HostProcessReferencePort` through the root `layer` export from `@svvy/sandbox` so
          `Sandbox.buildLaunchPolicy` runs from the service's layer-owned dependencies instead of
          carrying per-call Effect requirements. Commit(s): pending local changes
    - [ ] Expose the public `@svvy/sandbox` root only through the `Sandbox` service, layer
          factories, and launch-policy contracts used by runtime-owned Shell, Apply Patch, Execute
          TypeScript, and `svvyx ...` subprocess execution; helper-specific launch builders,
          helper path/argv construction, and sandbox launch facts are package-private.
  - [ ] Expose `PiAdapter` plus the root `@svvy/pi-adapter` `layer` for scoped pi session creation,
        prompt rebinding, ambient resource suppression, model metadata, turn streams, helper jobs,
        and pi-free event adaptation.
    - [ ] `@svvy/pi-adapter` public imports use only the `PiAdapter` service, layer factories, and
          `@svvy/pi-adapter/messages`; scoped session, turn, history, model, and helper-job behavior
          is available only through those public APIs.
  - [ ] Expose `@svvy/extensions` as an Effect v4 service/layer package.
    - [x] Expose the `@svvy/extensions` Effect service boundary for builtin registry
          reads, actor extension binding resolution, visible extension record projection, native tool
          schema document emission, and native tool command metadata lookup, with package tests and
          package-boundary coverage. Commit(s): pending local changes
    - [x] Expose the `request_user_input` native handler through `@svvy/extensions`, returning
          model-facing default answers plus an ordered `ExtensionRuntimeOperation` item wrapping a
          `request_input.create` runtime-effect request. Commit(s): pending local changes
    - [ ] Complete the full `Extensions` service surface from the package spec: actor-binding-aware
          native tool handler lookup, generated-context build, MDX instruction compilation,
          env/dependency planning, source edit sessions, generated package refresh, and declarative
          workspace-link repair planning.
    - [ ] Package builtin default prompts/instructions as declared MDX source files under
          `@svvy/extensions`, compile them to plain prompt text before generated-context or
          generated-package emission, and make builtin extension records point at those packaged
          template files instead of empty instruction source lists.
    - [ ] Keep native tool handler lookup actor-binding-aware end to end: runtime passes the same
          actor binding used for pi declarations, extensions rejects tool-name-only authorization,
          and every native handler returns exactly one model-facing result plus ordered
          `ExtensionRuntimeOperation[]`.
    - [x] Generated package file refresh writes into operation-scoped temp roots, validates
          persistent Workflows component/workflow imports before rendering, atomically replaces
          generated roots only after staged writes succeed, emits evidence manifests, and keeps the
          previous ready package active when staged writes fail. Commit(s): pending local changes
    - [ ] Generated package refresh records generated-package facts through runtime/state after
          successful package-owned replacement and leaves workspace-link application/status facts to
          runtime-owned link repair.
    - [x] Emit exact core reasoning-effort unions in generated workflow task-agent types instead
          of loose strings. Commit(s): pending local changes
    - [x] Keep generated-package file writers and Workflows package refresh internals
          package-private behind `Extensions.generatedPackages.refresh(...)`, with the
          `@svvy/extensions` package root exposing only the approved generated
          `@svvyx/extensions` app-edge/test discovery helpers. Commit(s): pending local changes
    - [x] Make generated `defineTaskAgent` calls reject locally unless exactly one prompt source is
          provided. Commit(s): pending local changes
  - [x] `Runtime.messages.submit` performs the durable queue insert through
        `RuntimeQueueStatePort`, publishes committed `afterCommit` invalidations through
        `RuntimeEventBus`, maps publication failures to typed submit errors, and invokes a
        runtime-owned `RuntimeMessageSubmissionPostCommitLane` only after publication so bootstrap
        supplies only the remaining prompt/provider/dispatch host facts without owning submit
        sequencing or state-port lookup. Commit(s): pending local changes
    - [x] `Runtime.messages.abort` handles the queued-message branch through
          `RuntimeQueueStatePort`, validates queued-row target ownership before mutation, publishes
          committed `afterCommit` invalidations through `RuntimeEventBus`, maps lookup/cancel
          failures to typed abort errors, and invokes a runtime-owned
          `RuntimeQueuedMessageAbortPostCommitHost` only after publication so the app adapter
          supplies only post-commit surface refresh behavior. Commit(s): pending local changes
    - [x] `Runtime.approvals.answer` resolves durable approval requests through
          `RuntimeApprovalStatePort`, starts or cancels the bound command through
          `RuntimeCommandStatePort`, clears approval waits through `RuntimeSessionWaitStatePort`,
          publishes committed `afterCommit` invalidations through `RuntimeEventBus`, and invokes a
          runtime-owned post-commit host only to resolve the existing live waiter. Commit(s):
          pending local changes
    - [x] Promoted `Runtime.sourceInvalidation` methods require complete source-invalidation
          wiring for `hint`, `reconcile`, `refreshGeneratedContext`, and
          `refreshGeneratedPackages`; missing wiring is a composition error and unsupported
          source-domain/scope combinations return explicit product contract errors. Commit(s):
          pending local changes
    - [x] `WriteCommandStdinResult` matches the runtime command-session contract: every result
          returns `commandId` plus one closed status (`accepted`, `stdin_closed`, `not_running`, or
          `already_terminal`), accepted writes must report the exact accepted UTF-8 byte count as
          `acceptedBytes`, non-accepted statuses do not carry byte counts, and backpressure remains
          a typed `RuntimeContractError` rather than a success status. Commit(s): pending local
          changes
    - [x] `RuntimeCommandStatePort.recordStdinWrite(...)` persists accepted stdin writes as durable
          command events with exact text, exact accepted byte count, and command-inspector
          invalidation, while public stdin admission, backpressure, process handles, and live
          command-session lookup remain runtime-owned command-session behavior. Commit(s): pending
          local changes
    - [x] `Runtime.commands.writeStdin(...)` validates durable command identity through
          `RuntimeCommandStatePort.findCommandById(...)`, uses
          `RuntimeCommandSessionService.writeStdin(...)` for live admission by durable `commandId`,
          records accepted writes
          through `RuntimeCommandStatePort.recordStdinWrite(...)`, publishes committed
          command-inspector invalidations, returns terminal/missing-live statuses without state
          writes, and keeps transient Shell `session_id` continuation lookup inside the
          agent-facing direct tool only; desktop, browser-tool, and headless callers use durable
          `CommandId` stdin APIs. Commit(s): pending local changes
    - [x] Desktop renderer adapters expose a renderer-safe command stdin action backed by
          `runtime.commands.writeStdin({ commandId, text, clientSubmission })`, route by explicit
          workspace/runtime facade identity only, and keep process handles, Shell `session_id`,
          focused panes, and renderer command state out of the product boundary. Commit(s): pending
          local changes
  - [ ] Expose the target `@svvy/runtime` package boundary: the root exports only `Runtime`,
        `Runtime.layer`, `layer`, and `createRuntimeFacade(...)`; `@svvy/runtime/bootstrap` exports
        only runtime config/readiness/shutdown helpers and the bootstrap-only
        `createRunTaskAgentLoopbackBridge(managedRuntime)` required by app bootstrap and package
        tests; all event-bus constructors, prompt-execution context constructors, queue dispatch
        helpers, request-input internals, generated-package refresh helpers, source coordination
        helpers, and svvyx runtime-effect transport helpers stay package-private or test-only.
    - [x] Runtime bootstrap defines a defaulted `RuntimeLayerConfig`, explicit
          `SVVY_RUNTIME_*` env parsing, config-service provisioning, and runtime-owned
          startup-readiness/shutdown-preparation hooks for the app bootstrap graph. Commit(s):
          pending local changes
    - [x] `Runtime.layer` is a no-argument production
          `Layer.Layer<Runtime, RuntimeLayerError, RuntimeLayerRequirements>` built with
          `Layer.effect(Runtime, makeRuntimeService())`; service-lift fixtures use
          `Layer.succeed(Runtime, fake)` only inside tests or internal fixtures, never through a
          package-root helper. Commit(s): pending local changes
    - [x] Implemented runtime facade groups live in package-owned `@svvy/runtime` Effect service
          construction. App/bootstrap provides explicit runtime host adapters plus
          config/readiness/shutdown layers, composes `Runtime.layer`, awaits
          `managedRuntime.context()` and startup readiness, and never lifts an app-built service
          with `Layer.succeed(Runtime, service)`. Commit(s): pending local changes
    - [x] Implemented runtime facade methods receive `RuntimeQueueStatePort`,
          `RuntimeRequestStatePort`, `RuntimeApprovalStatePort`, `RuntimeCommandStatePort`, and
          `RuntimeSessionWaitStatePort` as direct core-owned Effect service requirements. The app
          adapter wires those ports during layer composition as the product boundary. Commit(s):
          pending local changes
    - [x] `@svvy/runtime` has no direct `@svvy/state` package dependency or source/test import;
          runtime state access goes through core-owned state port service tags provided by
          app/bootstrap layer composition, and package-boundary tests enforce that manifest/import
          rule. Commit(s): pending local changes
    - [x] Extracted `@svvy/*` package sources cannot import across package roots with relative
          paths; package-boundary tests resolve relative imports and require cross-package access to
          use approved public package names. Commit(s): pending local changes
    - [ ] Runtime receives direct core-owned state ports and package service requirements while
          app/bootstrap wires state/package/platform layers only; runtime owns provider/model
          resolution, prompt submission logging, queue insertion/wake policy, request-input waits,
          approval waits, live prompt cancellation, source-invalidation handles, generated-package
          refresh policy, and runtime event bus semantics without callback tables.
    - [x] Define and implement the core-owned state ports required by
          `RuntimeLayerRequirements`: `RuntimeWorkspaceStatePort` records scoped durable workspace
          acquire/default/release owner facts, `RuntimeSurfaceLifecycleStatePort` records durable
          surface create/open/close lifecycle facts, and `RuntimeSourceStatePort` records
          source-version/source-save/source-delete facts. These ports are implemented by
          `@svvy/state`, return committed `StateMutationResult.afterCommit` descriptors, and are
          wired into the current runtime layer composition. Runtime-owned scoped
          workspace/surface/pi resources stay in `Runtime.layer` / keyed runtime layers. Commit(s):
          pending local changes
    - [ ] Public runtime groups for workspace lifecycle, surface lifecycle, extension dependency
          actions, and command cancellation land only through the runtime method ledger, core
          schemas, state/package ports, runtime-owned services, runtime events, shutdown behavior,
          and focused facade tests.
    - [ ] `@svvy/runtime` root exports only `Runtime`, `Runtime.layer`, `layer`, and
          `createRuntimeFacade(...)` as values; runtime facade types, facade error classes,
          transport appliers, operation appliers, event-bus internals, and bootstrap helpers are
          absent from the package root.
    - [x] App and desktop consumers derive runtime facade/service TypeScript shapes from
          bootstrap-owned facade factories or adapter return types instead of importing explicit
          runtime root facade/service type aliases. Commit(s): pending local changes
    - [ ] `@svvy/runtime/bootstrap` exports only runtime app-composition primitives:
          `RuntimeLayerConfig`, runtime config schemas/default/env parser,
          `RuntimeLayerConfigService`, `RuntimeLayerRequirements`, `RuntimeLayerError`,
          `createRuntimeLayerConfigLayer(...)`, `awaitRuntimeStartupReadiness(...)`,
          `prepareRuntimeShutdown(...)`, and the bootstrap-only Smithers task-agent loopback bridge
          helper; the underlying startup-readiness, shutdown-preparation, event bus, wait registry,
          source coordinator, queue dispatcher, and bridge implementation services stay
          package-private.
    - [ ] Runtime implementation helpers currently consumed by app/bootstrap host-edge code or
          tests are reachable only through package-private modules or package test fixtures;
          product app code reaches runtime behavior through `Runtime.layer`, the bootstrap
          app-composition primitives above, and `createRuntimeFacade(...)`, not through exported
          operation appliers or internal service constructors.
    - [x] App code imports core-owned prompt execution context contracts
          (`PromptExecutionContext`, surface kind, episode kind, external instruction source,
          `PromptExecutionRuntimeHandle`, and `createPromptExecutionContext(...)`) from
          `@svvy/core`; runtime owns production derivation of prompt-context input and
          `@svvy/runtime/bootstrap` does not re-export the constructor or handle. Commit(s):
          pending local changes
    - [x] `PromptExecutionContext` does not carry submitted prompt text; runtime prompt dispatch
          keeps the current user message as a local dispatch input instead of storing it in the
          reusable prompt execution context. Commit(s): pending local changes
    - [x] `PromptExecutionContext` carries external instruction identity, actor binding,
          read-status, order, and content hash metadata without carrying external instruction file
          bodies; generated context composition and inventory display keep using
          `@svvy/extensions`-owned file-backed source records, and `svvyx` subprocess environment
          context receives only the metadata view. Commit(s): pending local changes
    - [ ] App bootstrap composes the package graph once, creates exactly one app-owned
          `ManagedRuntime`, awaits `managedRuntime.context()` plus
          `awaitRuntimeStartupReadiness(managedRuntime)`, exposes desktop/browser/headless facades
          only after readiness, runs `prepareRuntimeShutdown(managedRuntime, ...)` before disposal,
          and never exposes two healthy app runtimes at the same time.
    - [ ] Workspace runtimes are acquired package-private `WorkspaceRuntimeMap` resources inside the
          single app-owned `ManagedRuntime`; desktop, browser-tool, headless, and app/bootstrap
          edge adapters never create independent runtime graphs and never own queue, prompt, state,
          recovery, generated-package, or tool-execution policy.
    - [ ] Runtime event subscriptions expose the target subscription object with `close()` and a
          close receipt, publish events into replay storage before fanout, enforce bounded
          subscriber buffers with rebaseline errors, and include required generation ids in every
          emitted event.
    - [ ] Runtime source-edit workflow-agent APIs use the exact core-owned source-edit DTO
          contracts, delegate file-backed reads/writes to `@svvy/extensions`, record source facts
          through state ports, and schedule generated-context/generated-package reconciliation after
          committed state mutation results.
    - [x] Source-edit request/result DTOs and schema decoders live in
          `@svvy/core/runtime-source-edit-contracts`; `@svvy/runtime` and app bootstrap consume them
          from `@svvy/core`, while `@svvy/extensions` no longer re-exports those shared contracts.
          Commit(s): pending local changes
    - [ ] Runtime source invalidation, command-session, and approval APIs include realistic success
          and rejected examples in the package spec and typed tests covering their public
          input/output contracts.
    - [ ] Execute `execution_plan` `ExtensionRuntimeOperation` items in the runtime-owned command
          lane through approval, sandbox, subprocess, file, stdin, artifact, and child-command
          services.
    - [ ] Workflow task-agent `runTaskAgent` bridge requests are handled by runtime-owned
          authenticated bridge services with durable idempotency, queueing, task-attempt surface
          lifecycle, generated-context binding, command facts, and pi turn orchestration.
  - [x] Run surface queue dispatch policy as a package-owned `@svvy/runtime` Effect over
        `RuntimeQueueStatePort`; runtime owns claim/dispatch policy, calls `@svvy/pi-adapter`
        through its public service boundary for retained pi materialization and prompt start, and
        publishes runtime notifications after committed `StateMutationResult.afterCommit`
        descriptors. App bootstrap supplies
        the composed layers and edge facades only. Commit(s): pending local changes
- [ ] Define core-owned runtime submission contracts in `@svvy/core`: user-messageable
      human/composer submit targets for orchestrator and handler surfaces, resolved
      `RuntimeSurfaceTarget` values for queue/runtime addressing, submit/abort/steer inputs and
      results, runtime events, and `RuntimeEffectRequest` schemas without renderer panel ids or
      pi-native message types.
  - [x] Define initial `@svvy/core` runtime prompt target, workflow-task runtime surface target,
        submit/abort/steer, submitted message, delivery, and compact runtime event contracts with
        strict boundary decoders that reject renderer-only submission fields. Commit(s): pending local
        changes
  - [ ] Define the closed `RuntimeEffectRequest` schemas and command-fact request inputs in
        `@svvy/core` as declarative outputs returned by extension handlers for `@svvy/runtime` to
        apply through `@svvy/state`.
    - [x] Add the runtime request-input state port contracts, apply the first
          `request_input.create` effect, and expose `runtime.requestInput.answer` with
          `AnswerRequestInputInput`, answer recording, and the spec-shaped
          `AnswerRequestInputResult.delivery` variants through `@svvy/runtime` with package tests
          and boundary coverage. Commit(s): pending local changes
    - [ ] Complete durable request-input answer idempotency: normalized `clientSubmission` values
          return `status: "duplicate"` with the original delivery result, nonblocking
          recorded-only answers do not resolve blocking waits, and committed nonblocking queued
          answers publish queue/surface invalidations only when a queue row is created.
    - [ ] Apply `handler_thread.start` through runtime-owned handler lifecycle services, state
          ports, command facts, queue insertion, after-commit notifications, and tests.
      - [x] Apply the prepared durable handler-thread start through `RuntimeThreadStatePort`,
            publish committed `afterCommit` invalidations through `RuntimeEventBus`, and wake each
            committed `initial_handler_start` queue row through `RuntimeQueueInsertPostCommitLane`.
            Commit(s): pending local changes
      - [ ] Runtime materializes full `thread_start` handler setup through runtime-owned services;
            app/bootstrap supplies only composed layers and edge facades.
    - [x] Apply `queue.insert` through runtime-owned queue insertion services, state ports,
          idempotency, committed `afterCommit` invalidation publication, and a runtime-owned
          `RuntimeQueueInsertPostCommitLane` that runs only after publication. Commit(s): pending local
          changes
      - [x] Add the `RuntimeEffectRequest` `queue.insert` applier through
            `RuntimeQueueStatePort`, preserving typed payload storage and focused tests. Commit(s):
            pending local changes
    - [x] Expose `Runtime.queues.steer(...)` through runtime-owned queue steering services, state
          ports, after-commit wakeups, and tests. Steering is not a `RuntimeEffectRequest`; effect
          paths that need urgent delivery create typed queue rows through `queue.insert` with
          explicit priority, ordering, timing, and idempotency facts. Commit(s): pending local
          changes
      - [x] Add queue-row steering through the runtime queue service and `RuntimeQueueStatePort`,
            validating queued-row target ownership before mutation, publishing committed
            invalidations, waking delivery through a runtime-owned post-commit host, and covering it
            with focused package and adapter tests. Commit(s): pending local changes
    - [x] Apply `actor_extension_binding.update` through current-surface binding services, state
          ports, generated-context stale marking, after-commit invalidations, and tests. Commit(s):
          pending local changes
    - [x] Apply `episode.record` through runtime-owned thread episode services, state ports,
          command/thread linkage, after-commit invalidations, and tests. Commit(s): pending local
          changes
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
  - [x] Persist target surface queue rows with `workflow_task_agent_start`, row-level workflow task
        and source-command lineage, priority/order sequence, claim lease/version, retry metadata,
        and expired-claim release through `@svvy/state`. Commit(s): pending local changes.
  - [x] Expose runtime turn lifecycle through `RuntimeTurnStatePort` for turn start, turn decision,
        and turn finish operations used by the prompt execution path. Commit(s): pending local
        changes.
  - [ ] Expose named runtime-facing `@svvy/state` services as the only state APIs
        `@svvy/runtime` uses: `RuntimeQueueStatePort`, `RuntimeTurnStatePort`,
        `RuntimeCommandStatePort`, `RuntimeApprovalStatePort`, `RuntimeThreadStatePort`,
        `RuntimeActorExtensionBindingStatePort`, `RuntimeEpisodeStatePort`,
        `RuntimeRequestStatePort`, `RuntimeSessionWaitStatePort`,
        `RuntimeExtensionContextImpactStatePort`, `RuntimeGeneratedPackageStatePort`,
        `RuntimeArtifactStatePort`, `RuntimeComposerDraftStatePort`, `RuntimeRecoveryStatePort`,
        and `RuntimeReadModelStatePort`.
    - [x] Expose `RuntimeComposerDraftStatePort.clearSubmittedDraft(...)` backed by structured
          session composer draft storage so runtime/state command paths have a narrow state port for
          committed draft cleanup when a queue row is already accepted. Commit(s): pending local
          changes
    - [x] Expose `RuntimeQueueStatePort.acceptSubmittedSurfaceMessage(...)` backed by one
          transactional structured-session commit for ordinary runtime composer sends, including
          queue insertion, submitted draft clearing, idempotency-key replay, and surface/session
          invalidations. Commit(s): pending local changes
    - [x] Expose `RuntimeRequestStatePort` backed by structured session request-input records for
          runtime-owned request creation, full request snapshots, open blocking request listing,
          answer delivery, timer pause commits, timeout defaulting, and cancellation. Commit(s):
          pending local changes
    - [x] Expose `RuntimeThreadStatePort.ensureHandlerThreadRunnable(...)` for runtime/native-tool
          code that must make a handler thread runnable and clear its wait projection without raw
          store access. Commit(s): pending local changes
    - [x] Route request-input tool execution through runtime-facing turn, command, request, and
          session-wait state ports; no accepted-tool path uses package-private structured-session-state
          implementation access. Commit(s): pending local changes
    - [x] Define runtime-owned request-input blocking wait lifecycle policy behind
          core-owned state ports: pending wait registration, timeout defaulting, wait
          projection, command terminal facts, and cancellation. Commit(s): pending local changes
    - [x] Add `RuntimeBlockingRequestInputWaitRegistry` as the Effect-native request-input wait
          registry path in `@svvy/runtime`, backed by `Deferred` handoffs, Effect sleep/clock
          timeout fibers, versioned timer invalidation for pause/reschedule, explicit registry
          close semantics, runtime-facing request/command/session-wait ports, and focused package
          coverage for timeout default resolution plus stale timer suppression. Commit(s): pending
          local changes
    - [ ] Compute extension usage impacts and affected-surface snapshots through runtime-owned
          generated-context binding and fingerprint reconciliation, preserving command output/fact
          behavior through named core-owned state ports.
    - [x] Compose request-input answer/pause state writes through runtime-owned lifecycle services
          that publish committed `StateMutationResult.afterCommit` descriptors through the runtime
          event bus and invoke runtime-owned `RuntimeRequestInputPostCommitLane` only after
          publication. Remaining runtime/package work covers wait, timer, and queue callback wiring
          through runtime-owned services. Commit(s): pending local changes
    - [ ] Compose request-input settings reads, wait-registry wiring, timeout scheduling, queue
          wakeups, and pi materialization through runtime-owned services plus state ports/facades;
          keep app-bootstrap host-adapter code limited to bootstrap wiring, host adapter provision,
          and facade exposure.
    - [ ] The full accepted-tool blocking request-input path runs inside `@svvy/runtime` services
          with deterministic `TestClock` coverage for timeout pause/resume, cancellation, surface
          close, and restart/recovery; Promise conversion exists only at app facade/tool boundaries.
    - [x] Return `StateMutationResult<T>` from every mutating runtime-facing state port so runtime
          lanes can distinguish committed values from committed after-commit invalidation
          descriptors. Commit(s): pending local changes
    - [x] Define core-owned `RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`, and
          `RuntimeSourceStatePort` contracts with explicit workspace acquire/release, surface
          lifecycle, and source-version/source-save/source-delete DTOs, and require those service
          tags through package-boundary tests. Commit(s): pending local changes
    - [x] Implement `RuntimeWorkspaceStatePort`, `RuntimeSurfaceLifecycleStatePort`, and
          `RuntimeSourceStatePort` in `@svvy/state` with SQLite-backed workspace-owner,
          surface-lifecycle, source-fact, and state-revision records, exported port layers, focused
          state tests, and package-boundary export ledgers. Commit(s): pending local changes
    - [x] Route `runtime.workspaces.acquire/acquireDefault/release` and
          `runtime.surfaces.createOrchestrator/open/close` through the injected core-owned state
          ports, publish returned `StateMutationResult.afterCommit` descriptors through the runtime
          event publication boundary, expose the path through the catalog-backed runtime facade, and
          cover it in the Effect test lane plus adapter unit tests. Commit(s): pending local changes
    - [ ] Runtime workspace/surface lifecycle methods acquire and release runtime-owned
          workspace/surface scopes, materialize pi sessions through `@svvy/pi-adapter`, start source
          and recovery workers, and return readiness only after the live runtime resources are
          available or a degraded readiness result has been committed.
    - [ ] Update every runtime service to collect committed
          `StateMutationResult.afterCommit` descriptors and publish them through the runtime event
          bus; app/bootstrap host adapters call facades or return closed operation results and do
          not consume state ports directly.
      - [ ] All runtime snapshot-impact callers consume
            `RuntimeExtensionContextImpactStatePort` mutation results, collect committed
            `StateMutationResult.afterCommit` descriptors, and publish runtime notifications only
            from committed descriptors.
  - [ ] Back named runtime-facing `@svvy/state` services with internal SQLite repositories and
        transaction services; keep store and database objects private to `@svvy/state`.
  - [ ] `@svvy/runtime` owns prompt submission, queue claiming, active-turn lifecycle, stream
        finalization, and recovery.
    - [ ] `Runtime.layer` composes state ports, `Sandbox`, `PiAdapter`, `Extensions`, source
          invalidation, event publication, queue workers, accepted native-tool execution, and
          runtime startup readiness inside the app-owned runtime graph; package-boundary tests reject
          any additional package-root runtime exports or renderer, desktop, app-entry,
          browser-tool, headless, or shared contract `ManagedRuntime.make`
          usage.
    - [ ] Public `Runtime` service and facade methods are promoted only when their schema-backed
          contracts, state ports, runtime-owned services, emitted invalidations/events, shutdown
          behavior, and `test:effect` coverage exist; no public runtime group returns
          `unsupported-operation` as a placeholder or delegates product policy to app/bootstrap
          callback ports. Contract-level unsupported domain/scope/capability inputs are allowed
          only when the method ledger names them and tests prove the service path is fully wired.
    - [x] Runtime message submission owns canonical queued `RuntimeSubmittedMessage`
          serialization, prompt telemetry, idempotent queue insertion, and package tests. Commit(s):
          pending local changes
    - [x] Runtime queued-message abort owns target validation, queue-row cancellation, committed
          invalidation publication, and post-commit surface refresh through runtime state/event
          ports and focused package plus adapter tests. Commit(s): pending local changes
    - [ ] Public `Runtime.messages.submit(...)` handles `delivery` intent after durable queue
          insertion by publishing committed invalidations, waking the targeted runtime queue when
          delivery is `enqueue-and-run`, and relying on runtime-owned queue claiming to call
          `@svvy/pi-adapter` through its service boundary for queued runtime-message-to-pi-message
          conversion.
    - [x] Prompt queueing, command-triggered queue inserts, workflow task-agent turn starts, and
          runtime-queued prompt handoff run through the app-bootstrap runtime facade over
          runtime-owned queue/state ports, with ordered async state writes and committed
          after-commit publication. Commit(s): pending local changes
    - [x] Runtime approval request creation, auto-review resolution, user answer resolution,
          command wait/cancel/start transitions, open-approval cancellation, and session-wait
          clearing run through the Promise-based app runtime boundary, core-owned state ports
          implemented by `@svvy/state`, and committed after-commit publication. Commit(s): pending
          local changes
    - [x] Pi callback command projection for streamed tool-call arguments and tool-execution
          command lifecycle writes runs through the runtime-owned command/session lane using
          `RuntimeCommandStatePort` writes and committed after-commit publication, with prompt
          cleanup awaiting queued writes before clearing prompt runtime state. Commit(s): pending
          local changes
  - [ ] Runtime owns accepted native-tool execution end to end: it creates the command envelope,
        invokes `@svvy/extensions` handlers for the loaded actor binding, applies returned
        `ExtensionRuntimeOperation` items, applies `runtime_effect` requests through state and
        package services, executes `execution_plan` values through approval, sandbox, subprocess,
        file-effect, stdin/stdout/stderr, and child-command lanes, publishes state after-commit
        notifications, wakes affected queues, and records terminal command facts.
    - [ ] Blocking `request_user_input`, thread-control tools, runtime-state tools, and
          workflow-task `runTaskAgent` bridge effects execute through runtime-owned operation
          services; native tool declarations, metadata, and handlers live in `@svvy/extensions`,
          and accepted-tool execution in `@svvy/runtime` owns state ports, handler-thread creation,
          queue mutation, and command terminalization.
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
    - [x] `@svvy/pi-adapter` owns conversion from canonical `RuntimeSubmittedMessage` values into
          pi user messages, including attachment prompt signatures, image blocks, and snippet
          provenance, through the public root adapter API. Commit(s): pending
          local changes
  - [ ] Keep pi custom-tool conversion inside `@svvy/pi-adapter` turn setup so public package
        boundaries expose only `@svvy/core` native-tool definitions, runtime event contracts, and
        renderer-safe result schemas; pi-native tool setup and event adaptation stay inside
        `@svvy/pi-adapter`.
    - [x] `@svvy/pi-adapter` root exports only `PiAdapter` and layer factories, while
          `@svvy/pi-adapter/messages` owns pi-message conversion helpers; neither public surface
          exposes a Promise facade, `AsyncIterable` facade, edge callback bridge, or pi-native
          session/tool/model object exports. Commit(s): pending local changes
    - [ ] App/bootstrap imports no package-private pi-adapter internals.
    - [ ] Managed-session materialization goes through the public `PiAdapter` service; implementation
          tests may use package-private internals, and the public package surface does not export
          `@svvy/pi-adapter/internal/session`.
    - [ ] `@svvy/pi-adapter` implements the full target service surface for `sessions`, `turns`,
          `history`, `models`, and `helperJobs`; `@svvy/core` exports the matching
          `InterruptPiTurnInput`, pi session reference, model-list, title-result, restore/fork
          history, and runtime-event contracts with package-boundary tests.
    - [x] `@svvy/pi-adapter` owns package-local normalization for every supported pi `AgentEvent`
          and nested assistant-message event in the exact `PiRuntimeEvent` table in
          `pi-adapter.spec.md`, preserves pi `contentIndex`, and fails closed on unknown events
          before runtime receives any pi-native object.
    - [ ] `@svvy/pi-adapter` synthesizes `pi.tool_execution.started`,
          `pi.tool_execution.updated`, and `pi.tool_execution.finished` around callback tools when
          pi does not emit native tool-execution events.
  - [ ] `@svvy/extensions` owns generated actor-context construction, actor binding
        resolution/validation, native tool handlers, `svvyx` dispatch, generated-package
        production, and immutable workspace-link plan construction through `@svvy/core` contracts.
        `@svvy/runtime` schedules/applies link repair and commits generated facts through
        `@svvy/state`.
    - [ ] Build both generated app-owned packages, `@svvyx/extensions` and `@svvyx/workflows`,
          through `@svvy/extensions` using `GeneratedPackageRootPort`, `.svvy-generated-package.json`
          evidence manifests, package status output, and declarative workspace-link repair plans;
          runtime applies those plans and records workspace-link facts.
    - [ ] Store base actor prompts, builtin extension instructions, and reusable prompt assets as
          package-owned MDX/source assets under `@svvy/extensions`; generated context assembly reads
          those package-owned sources and never treats generated package roots, profile rows, or
          renderer code as prompt-body owners.
    - [ ] Generated package refresh writes to scoped temp roots and atomically replaces final
          outputs only after validation; implementation helpers for render/write/discovery remain
          package-private behind `Extensions.generatedPackages.refresh(...)` and
          `Extensions.generatedPackages.planWorkspaceLink(...)`.
    - [ ] `Extensions.svvyx.run(...)`, source edit open/save, dependency readiness, command schema
          generation, native-tool schema generation, and generated package output validation are
          service-backed package operations with contract tests; trusted svvyx child-process result
          transport carries only signed closed transport intents and does not own generic
          user-extension dispatch. `runtime_effect.request` transport intents use `@svvy/core`
          codecs and are replayed by `@svvy/runtime` inside the parent command-session pipeline;
          broader extension state-change replay is coordinated by `@svvy/runtime` through
          `@svvy/state` facts, not transport-owned.
    - [ ] Extension handlers return `ExtensionHandlerResult` with
          `operations?: readonly ExtensionRuntimeOperation[]` as the only runtime-work field; core
          schemas, generated declarations, handlers, runtime application, and tests accept only
          wrapped `{ kind: "runtime_effect", request }` and `{ kind: "execution_plan", plan }`
          items.
    - [ ] Source-edit APIs use the target `sourceRef` contract, generated-package refresh is
          atomic and package-owned, `@svvy/extensions` returns immutable workspace-link plans,
          `@svvy/runtime` applies repair and records link facts, generated context cache ownership
          lives in `@svvy/extensions`/`@svvy/runtime`, and root exports expose only the canonical
          service/layer. Any non-Effect inspection surface requires a separately specified public
          subpath with exact methods and boundary tests before implementation.
    - [ ] MDX prompt and instruction assets compile into plain prompt text before `Prompts.*` or
          generated actor-context output is emitted; raw MDX source and frontmatter never appear in
          agent-facing prompt bodies or generated declarations.
    - [ ] Generated `@svvyx/workflows` and `@svvyx/extensions` declarations are exact, stable, and
          package-boundary tested, including pinned reasoning-effort unions, allowed imports only,
          and no app/runtime/private implementation imports.
  - [ ] Execute Shell, Apply Patch file effects, Execute TypeScript runtime launches, user-visible
        `svvyx` shell commands, and extension dependency install/update actions through
        `@svvy/runtime` command lifecycle using `@svvy/extensions` command plans/handlers,
        `@svvy/sandbox` launch policy, and scoped Effect subprocess services with fake
        process-spawner test layers. `@svvy/extensions` returns ordered
        `ExtensionRuntimeOperation` items for runtime-owned work that needs subprocess, file,
        approval, sandbox, command-fact, child-command, or state effects; `@svvy/runtime` processes
        those items through `@svvy/sandbox`, `@svvy/state`, and scoped Effect subprocess services.
        Pure validation may remain inside `@svvy/extensions`.
  - [ ] Build sandbox launch policies as a scoped union where managed mode owns helper/profile
        artifacts for the subprocess lifetime and full-access mode omits managed OS sandbox
        enforcement entirely.
  - [ ] Run source invalidation as an Effect-scoped `@svvy/runtime` service with watcher events as
        hints, deterministic fingerprint scans, lifecycle-managed subscriptions, Effect
        `Clock`/`Schedule`/`Stream` timing, and `@effect/vitest` `TestClock` schedule tests instead
        of `setTimeout`, `setInterval`, host callback timers, sleeps, or polling-based completion
        signals.
    - [ ] One runtime-owned app-global coordinator refreshes generated `@svvyx/extensions` and
          `@svvyx/workflows` packages, records committed facts, and wakes acquired workspace
          link-repair workers after commit.
    - [ ] Complete generated-context build, binding, and stale-surface persistence through
          `RuntimeActorExtensionBindingStatePort`, `RuntimeExtensionContextImpactStatePort`, and
          `RuntimeGeneratedPackageStatePort`, with runtime usage before prompt dispatch and focused
          state/runtime tests for read-only inspection, binding mutation, context-impact replay, and
          generated-package fact invalidations.
  - [ ] Run workspace/surface queue workers, prompt locks, wakeups, scoped disposal, and semantic
        test receipts as Effect-native `@svvy/runtime` services.
  - [x] Add the `@effect/vitest` dependency and `test:effect` Vitest lane for
        `packages/**/*.effect.test.ts`, wire it into `bun run check` as a separate lane alongside
        the existing Bun `test:unit` suite, and exclude `*.effect.test.ts` from the Bun lane.
        Commit(s): pending local changes
  - [ ] Service/layer tests run in the Effect lane without manual `runTestEffect` helpers; runner
        allowlists prevent ordinary package and app tests from creating manual runtimes or importing
        `@effect/vitest` outside Effect-lane files.
    - [ ] Package service/layer tests live under `packages/**/*.effect.test.ts` and use
          `@effect/vitest` `it.effect`, fake layers, `TestClock`, and semantic receipts. Bun-lane
          manual `runTestEffect` / `runScopedTestEffect` helpers are absent from package
          service/layer tests.
  - [ ] Add focused Effect lifecycle tests for shared layer memoization, `Layer.fresh` / local
        isolation exceptions, finalizer failure reporting, app-bootstrap readiness-failure disposal,
        task-agent bridge server lifetime, and resource-matrix coverage.
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
    - [x] Implement `createDesktopApp(input)` as the only `@svvy/desktop` root product
          bootstrap adapter; app bootstrap injects prebuilt runtime/state/command facades plus
          desktop host adapters, and desktop never receives raw `ManagedRuntime`, Effect services,
          package-private ports, layer factories, SQLite, pi, sandbox, or generated-package
          handles. Commit(s): pending local changes
    - [ ] App bootstrap exposes exactly one healthy app-owned `ManagedRuntime` after
          `managedRuntime.context()` and runtime-owned startup readiness, exposes zero during
          startup/failure/retry/shutdown, and closes bridge delivery before runtime replacement;
          replacement bridge delivery opens only after the replacement runtime reaches readiness.
    - [ ] Add boundary tests for exact Effect service ids, public subpath export ledgers, actual
          boundary-schema `Schema.optionalKey(...)` usage, exported sync decoder naming, canonical
          runtime root layer exports, generated-root resolution through `GeneratedPackageRootPort`,
          rejected package names across non-vendor docs/source/manifests, product-doc bans for
          repo-local shipped-architecture paths, Effect runner zones, and exact root dependency pins
          for architecture-critical host packages.
    - [ ] Every mutating state-backed Effect port method returns
          `StateMutationResult<T> = { value: T; afterCommit: readonly StateInvalidationDescriptor[] }`,
          including app logs and methods that append, record, claim, release, mark, resolve, cancel,
          clear, ensure-by-writing, or persist state; public core/state port tests reject bare write
          return values and raw `*Json` state-port payload leaks where a structured contract exists.
    - [ ] `@svvy/state` root exports the target state layer, named state-backed port layers,
          approved read facade factories, `StateReadModels`, `StateCommands`, and
          `createStateCommandsFacade(...)`; it does not export broad stores, repositories,
          transactions, SQL clients, migrations, structured-session-state stores, or table helpers.
      - [x] Structured-session artifact selectors are pure over provided state records: missing
            backing-file status is mapped onto artifact records by `@svvy/state` storage code, and
            selector projection code does not import `node:fs` or call `existsSync`. Commit(s):
            pending local changes
  - [ ] Renderer/shared code imports `@svvy/core` contracts for runtime-facing data while
        app-bootstrap-provided `@svvy/runtime` and `@svvy/state` facades perform runtime/state work,
        without pi-native message/session/model imports or direct pi `Agent` mutation.
  - [ ] Store base actor prompts and builtin instruction material as `@svvy/extensions` source
        assets, and keep profile settings free of profile-local `systemPrompt` blobs.
  - [ ] Keep concrete native tool declarations, actor-specific metadata, actor slicing, projection
        metadata, and handler lookup in `@svvy/extensions`, leaving `@svvy/core` with pi-free
        native-tool declaration, invocation input, result, `RuntimeEffectRequest`, and schema
        shapes. Cover the package boundary and import through the public workspace package.
- [ ] Implement the `@svvy/extensions` Effect service boundary for registry reads, actor binding,
      generated context, native handler lookup, `svvyx` dispatch, dependency readiness, source
      build state, generated-package production, and builtin capability/source-record resolution;
      keep registry helper functions package-private.
  - [x] Own native tool command projection metadata in `@svvy/extensions`, including actor
        availability, command visibility, argument snapshot policy, generic versus self-recorded
        execution command policy, and turn-decision projection; `@svvy/runtime` command/projection
        trackers consume that metadata instead of duplicating specialized tool-name lists. Commit(s):
        pending local changes
  - [ ] `@svvy/core` owns schema-backed command facts, command events, queue payload/read-model
        contracts, provider/settings/generated-context/extension inventory contracts, sandbox policy
        snapshots, and pi-adapter port contracts. Public shared contracts do not carry pi-native
        transcript objects.
  - [ ] `@svvy/pi-adapter` owns pi-native session creation, raw pi event adaptation, model
        registry/auth metadata, title helper jobs, and forked-history reads behind its Effect
        service boundary.
  - [ ] Implement sequenced `@svvy/runtime` event publication over committed state changes and pi
        stream patches, then bridge those typed events to `@svvy/desktop` with gap detection and
        read-model rebaseline.
  - [ ] `@svvy/state` owns prompt history, composer drafts, and surface transcript read models.
        Desktop/RPC payloads use `@svvy/core` schemas, public handler-surface identity, and
        renderer-safe read models; submit responses and snapshots never contain pi transcript
        objects or renderer `Agent` state.
  - [ ] Runtime source edits expose only methods backed by exact `@svvy/core` schemas,
        `@svvy/extensions` file operations, `@svvy/state` source-fact writes, runtime Effect
        methods, facade wiring, and package-boundary/contract tests. Workflow-agent,
        workflow-prompt, workflow-component, and workflow source create/duplicate/delete are not
        public runtime methods until those pieces land together.
  - [ ] Runtime state, prompt, queue, extension, and command execution ownership lives in the
        package service graph, with `@svvy/desktop` consuming bootstrap-provided runtime/state
        facades through renderer bridge adapters.
- [ ] Drive prompt submission, queue claiming, turn execution, handler-thread lifecycle,
      request-input delivery, generated-package refresh scheduling, recovery, title jobs, command
      tracking, and runtime event publication through `@svvy/runtime`.
- [ ] Expose desktop, browser-tool, and headless automation facades over the single app-owned
      `ManagedRuntime` after startup readiness, with Promise/callback/`AsyncIterable` edges that
      validate payloads, keep shutdown/disposal outside facade ownership, and refetch state read
      models after runtime notifications.
- [x] `@svvy/extensions` generates only app-owned generated authoring package files and immutable
      workspace-link plans for `@svvyx/workflows` and `@svvyx/extensions`; `@svvy/runtime` applies
      link plans and records facts, and generated packages are not public `@svvy/*` packages,
      reusable SDKs, or `execute_typescript` runtime facades. Commit(s): pending local changes

## 0. Source Invalidation

- [x] Product source invalidation uses runtime-owned app-global and workspace coordinator lanes for
      Workflows, Extensions, external instructions, and discovered read-only host snippets;
      source/build facts commit through `@svvy/state`, and runtime publishes notifications from
      committed after-commit descriptors. Commit(s): `03bf43f69`
- [x] Keep generated `@svvyx/workflows` output, generated `@svvyx/extensions` output, extension build directories, workspace `.smithers/node_modules/@svvyx/*` links, and workspace `.svvy/generated` prompt previews outside the watcher trigger set. Commit(s): `03bf43f69`
- [x] Rebuild or reread only affected derived state after source fingerprints change, including `@svvyx/extensions` and dependent `@svvyx/workflows` refreshes when needed, typed read-model invalidations for desktop cache refetch, and fingerprint-only stale prompt bindings for affected open surfaces. Commit(s): `03bf43f69`
- [x] Protect editable file-backed workflow-agent source drafts with shared source-version compare-and-swap saves, warning-state autosave controls, and explicit keep-editing, discard-local, and overwrite-external conflict actions. Commit(s): `33b91c0ca`
- [ ] Invalid or unreadable source records appear directly in the relevant read models with
      diagnostics, while the last ready generated output remains active.

## 1. Structured Session State

- [x] Build a POC session overlay document and validate how it can sit above pi session data. Commit(s): `c432f4e`
- [x] Persist a minimal structured session overlay root above pi session data. Commit(s): `b510857`, `fff54d7`
- [x] Add `surfacePiSessionId` linkage on turns so orchestrator-surface and handler-thread turns use one model. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist handler-thread records with title, objective, objective state, backing pi session id, and durable thread linkage. Commit(s): `fff54d7`, `f53c9b8`
- [x] Persist artifact references independently from transcript parsing at thread and command scope. Commit(s): `fff54d7`
- [x] Store artifacts under the configured artifact directory as per-session files, with mutable artifacts
      directly under `<artifactDir>/<sessionId>/`, immutable artifacts under
      `<artifactDir>/<sessionId>/immutable/`, exact stored filenames, immutable metadata, refreshed
      file-backed byte/digest facts, and no reliance on OS-level file flags for immutability. Commit(s): pending local changes
- [x] Persist ordered update and conclusion episode records each time a handler thread reports to the orchestrator, while preserving earlier episodes for later follow-up turns. Commit(s): `d323012`
- [x] Persist session wait state as a frontier-level summary derived from surface, workflow, request-user-input, and session wait projection. Commit(s): `fff54d7`, `f53c9b8`, `43a26cb`
- [x] Drive structured session state only from explicit runtime producers or tool events. Commit(s): `fff54d7`, `59fc34e`, `43a26cb`
- [x] Reconstruct workspace and session summaries from structured state on app load. Commit(s): `b510857`, `fff54d7`
- [x] Project live tool use for one surface through `@svvy/runtime` and `@svvy/state` command
      records, covering tool item start, accepted argument snapshots, command output deltas,
      structured patch snapshots, approval/wait state, final command facts, and renderer recovery
      after reload. Commit(s): pending local changes
  - [x] Pre-runtime generic-direct-tool argument streaming for `exec_command` and `apply_patch` is supported when pi exposes incremental tool-call argument events; `svvy` does not invent fake streaming callbacks. Commit(s): pending local changes
  - [ ] Pre-runtime streaming covers `execute_typescript` source, native-control objective/report/question arguments, in-progress `apply_patch` patch previews, and approval-state live updates.
- [x] Persist and render live tool projection across native direct tools, thread-control tools,
      extension loading, `execute_typescript`, command-family Shell surfaces such as current
      `svvyx ...` output, and prompt-only CLI usage such as Smithers without introducing a
      workflow-specific rendering or recovery path. Commit(s): pending local changes
  - [x] Preserve `svvyx workflows ...` failure command facts in the thrown `exec_command` JSON payload and persist those facts on the runtime-allocated failed command record through the `@svvy/runtime` command lifecycle service. Commit(s): pending
  - [x] Persist running command records for direct tools at execution start and waiting command records for native control tools that pause for user input. Commit(s): pending
  - [x] Persist final command-family `exec_command` stdout/stderr or JSON output as durable command-subject output events through the `@svvy/runtime` command lifecycle service, and settle structured `{ ok: false }` `svvyx` results as failed command records. Commit(s): pending
  - [x] Persist accepted `execute_typescript` source on the parent command, recover extension-facade child inputs from child command records, and stream captured TypeScript console stdout/stderr into the shared durable command-output projection. Commit(s): pending
  - [x] Persist blocking `execute_typescript` static diagnostics as durable command-subject diagnostic events and recover them into neutral transcript command cards plus command inspectors. Commit(s): pending
  - [x] Expose recovered command output events in the command inspector read model and render stdout/stderr sections in the ordinary command inspector. Commit(s): pending
  - [x] Render transcript command rollups through neutral tool-call cards instead of workflow-shaped cards. Commit(s): pending
  - [x] Recover transcript command rollups from durable command output events, retained artifacts, and final command facts after reload without transcript prose parsing. Commit(s): pending
  - [x] Persist accepted command argument snapshots on structured command records and recover them into neutral transcript command cards after reload. Commit(s): pending
  - [x] Expose ordered command argument snapshots through command rollups and command inspectors so transcript cards and fine-grained inspection use the same durable read model. Commit(s): pending local changes
  - [x] Expose command rollup started and finished timestamps so transcript execution spans can show duration without renderer guessing. Commit(s): pending local changes
  - [x] Keep terminal command records immutable after success, failure, or cancellation so prompt cleanup cannot overwrite authoritative final facts. Commit(s): pending local changes
  - [x] Render transcript tool cards from structured command fields with explicit inspect and artifact actions, while de-duplicating matched tool-result rows. Commit(s): pending local changes
  - [x] Render transcript tool cards as execution spans with collapsed action/target/status/duration/counts/outcome and expanded bounded semantic sections for arguments, command target, file changes, diagnostics, progress, grouped stdout/stderr, child commands, and artifacts while keeping full raw detail in the command inspector. Commit(s): pending local changes
  - [x] Persist accepted argument snapshots for specialized native control commands (`thread_start`, `thread_followup`, `thread_request_report`, `thread_report`, and `request_user_input`) while preserving their existing authoritative final facts. Commit(s): pending
  - [x] Persist direct command records for Extension Loading and read-only thread state tool executions through `@svvy/runtime` command lifecycle services and `RuntimeCommandStatePort`, including active-runtime validation failures, while the pi-adapter tool-event adapter records only the generic pi callback lifecycle and does not own command-state writes for those native names. Commit(s): pending
  - [x] Persist `request_user_input` created request/question-count command progress and final nonblocking `RequestUserInputResult` facts on the authoritative command record. Commit(s): pending
  - [x] Return structured final `apply_patch` file-change facts from the real direct tool result so `@svvy/runtime` command tracking persists actual patch facts instead of synthetic test-only facts. Commit(s): pending
  - [x] Persist accepted `apply_patch` file-change snapshots as durable command events and recover them into neutral transcript command cards and command inspectors alongside final patch facts. Commit(s): pending
  - [x] Project read-only thread state tools (`thread_current`, `thread_list`, `thread_episodes`, and `thread_group`) through ordinary command records instead of dropping them at the generic command projection boundary. Commit(s): pending
  - [x] Persist live stdout/stderr chunks from ordinary `exec_command` execution as durable command-subject output events, update the original command with final facts for long-running `write_stdin` continuations, and materialize terminal stdout/stderr output events for non-streaming callers from the final command result without changing authoritative terminal command facts. Commit(s): pending
  - [x] Recover durable `command.progress` lifecycle events from ordinary command records into neutral transcript and command-inspector projection, without adding a workflow-specific renderer. Commit(s): pending
  - [x] Recover durable accepted `command.stdin` receipts into command rollups and command
        inspectors with explicit `stdin.mode`, `stdin.canAttemptWrite`, and ordered
        `stdin.acceptedWrites`, while keeping write admission authoritative in
        `Runtime.commands.writeStdin(...)`. Commit(s): pending local changes
  - [ ] Render the command-inspector stdin composer for running continuable `exec_command` records,
        submit through the renderer-safe command stdin action backed by
        `runtime.commands.writeStdin(...)`, show `accepted`, `stdin_closed`, `not_running`, and
        `already_terminal` results, and refetch the inspector after accepted writes without
        appending transcript text or calling the model-facing `write_stdin` tool.
  - [x] Add retained immutable log artifacts for oversized command-family stdout/stderr, link them to the source command, and keep retained stream text out of stored command facts and durable output events while preserving small-output event projection. Commit(s): pending

## 2. `execute_typescript`

- [x] Build a POC `execute_typescript` runtime with compile or typecheck-before-run diagnostics and the adopted TypeScript input/output contract. Commit(s): `76cc8f3`, `b41e5e6`
- [x] Expose the resolved `execute_typescript` runtime surface with no global `svvy` client and no injected `api` object. Commit(s): pending local changes
- [x] Persist each attempted snippet as a file-backed artifact before execution, with SQLite metadata and path indexing. Commit(s): `76cc8f3`, `fff54d7`
- [x] Route the top-level `execute_typescript` action through the same approval-boundary path as other approval-gated native actions before executing submitted code. Commit(s): pending local changes
- [x] Make the top-level `execute_typescript` approval hook use the shared mode-aware runtime approval request shape, persist source before review, and omit the boundary in `approvalMode: "full-access"`. Commit(s): pending local changes
- [x] Add an injectable runtime approval-boundary seam before direct `exec_command`, app-owned
      `svvyx ...` command-family dispatch, and `apply_patch`, with `approvalMode: "full-access"`
      omitting that seam. Commit(s): pending local changes
- [x] Pass the injected mode-aware approval-boundary seam into session-created direct tools and top-level `execute_typescript`, with managed-session denial coverage for Shell and TypeScript tool calls. Commit(s): pending local changes
- [x] Connect the injected approval-boundary seam to app-owned automatic review and actor-local user approval requests, with durable runtime approval records, pending user approval projection, and approve/deny RPC/UI actions. Commit(s): pending local changes
- [x] Settle denied and cancelled runtime approval requests by clearing wait state, resolving the blocked tool call without running it, and recording cancelled command facts. Commit(s): pending local changes
- [x] Use a fail-closed app-owned automatic review policy that classifies and denies unsafe approval-boundary requests without relying on prompt memory. Commit(s): pending local changes
- [x] Generate actor-specific `execute_typescript` declarations containing only the current actor's loaded TypeScript-enabled `svvyx` extension facades under `extensions["<id>"]`, plus only those extensions' command map types. Commit(s): pending local changes
- [x] Make `incur/client` importable in `execute_typescript` snippets for public Incur types and `Client.ClientError`. Commit(s): pending local changes
- [x] Run a simple composed scripted task through `execute_typescript`. Commit(s): `76cc8f3`
- [x] Build a POC artifact and tracing pipeline for `execute_typescript` execution. Commit(s): `76cc8f3`
- [x] Capture `execute_typescript` logs and nested command traces as artifacts and structured command records. Commit(s): `76cc8f3`, `fe53a3b`, `59fc34e`
- [x] Keep thread orchestration, thread handling, extension loading, and request-user-input as small `svvy`-native control surfaces while Smithers workflow operations use official CLI commands through Shell. Commit(s): `a02bd48`
- [x] Expose actor-scoped loaded builtin Artifacts and Workflows `execute_typescript` generated TypeScript facades only when the actor's resolved extension binding loads those TypeScript-enabled facades, with generated TypeScript declarations for their command maps and Incur-compatible `extensions["<id>"].run(extensionCommandId, input)` calls backed by `@svvy/extensions` handlers and `@svvy/runtime` child command facts, while keeping local Incur actions and generated internals unexposed to snippets. Commit(s): pending local changes
  - [x] Extract current-build Incur command manifests during successful user `svvyx` builds and generate TypeScript declaration files from those command maps for loaded extension facades. Commit(s): pending
  - [x] Generated TypeScript facade declarations come only from loaded actor-scoped builtin
        app-owned facades; user `svvyx` extensions do not contribute `execute_typescript` facades,
        and Workflows remains absent from default orchestrator and workflow-task-agent
        `execute_typescript` sets. Commit(s): pending local changes
  - [ ] Add sandboxed execution for loaded builtin app-owned TypeScript facades through public Incur client
        semantics, preserving schema-backed input/output, output controls, the non-streaming
        `Run.Result` envelope, rich `Client.ClientError` metadata, recursive exact secret
        redaction, parent-linked child command facts, and hidden generated internals.
  - [ ] Project loaded builtin app-owned facade `Run.StreamResponse` streaming responses and
        `Cta.run()` command executions through runtime-owned child command facts and tests once the
        product has the required child-command recording contract.
- [x] Expose Codex-like Shell and Apply Patch extensions, with `exec_command`, `write_stdin`, and `apply_patch` as the normal coding-agent work interface. Commit(s): `76cc8f3`, `29d8452`
- [x] Package an app-owned Codex-derived native sandbox helper that owns ordinary `exec_command`
      subprocess sandboxing and `apply_patch` file effects through macOS Seatbelt
      `/usr/bin/sandbox-exec`, with `Read`/`Write`/`None` entries, most-specific path precedence,
      equal-specific `None > Write > Read` precedence, default read access, cwd/project-root
      writable roots, explicit writable roots, read-only subpaths, protected `.git`, `.agents`, and
      `.codex` metadata carveouts, network allow/deny, full-access sandbox omission, sandbox-denial
      reporting, and fail-closed helper setup. Commit(s): pending local changes
  - [x] Keep TypeScript responsible for product policy assembly, approval integration, command
        projection, and tests on the ordinary `exec_command` and `apply_patch` paths, with actual
        subprocess/file effects routed through the native helper when managed sandboxing is active.
        Commit(s): pending local changes
  - [ ] Keep managed sandbox enforcement owned by the native helper and `@svvy/sandbox`, with
        TypeScript limited to product policy assembly, approval integration, generated-output and
        artifact projection validation, command projection, and tests on the ordinary
        `exec_command` and `apply_patch` paths.
  - [ ] Implement Codex permission-profile compilation and runtime policy transforms in the native
        helper, including symbolic roots such as `:root`, `:project_roots`, `:tmpdir`, and
        `:slash_tmp`; deny-read path and glob entries with fail-closed invalid-glob handling;
        additional-permission normalization, merge, and intersection; executor-required
        runtime-readable roots; and managed-network denial/approval behavior. Generated TypeScript
        declarations may describe these contracts, but must not become the enforcement model.
  - [x] Route all agent Shell usage of `svvyx ...` command families through the ordinary Shell
        `exec_command` path to the real app-owned Incur CLI, preserving the same approval, sandbox,
        command facts, output streaming, and projection path as other shell commands.
    - [x] Route app-owned Artifacts `svvyx artifacts create`, `inspect`, `list`, and `delete`
          through `@svvy/extensions` validation and ordered `ExtensionRuntimeOperation` items;
          `@svvy/runtime` applies those operations through artifact storage and
          `RuntimeArtifactStatePort`, records command facts, and exposes artifact read models through
          `@svvy/state`. Commit(s): pending local changes
    - [x] Route `svvyx artifacts open` through the real app-owned CLI path, returning a declarative
          inspector-open intent recorded in command facts and consumed by `@svvy/desktop`.
          Commit(s): pending local changes
    - [x] Route `svvyx workflows`, `svvyx extensions`, and user/runtime `svvyx <extension-id> ...`
          dispatch through the real app-owned `svvyx` CLI process with explicit app-owned writable
          roots, env/secret injection, generated-package change signals, and dependency-approval
          context. Commit(s): pending local changes
  - [x] Preserve Codex approval/escalation flow: compute approval before sandbox selection; approval
        permits starting the action but does not imply unsandboxed execution; execpolicy allow
        omits sandboxing only when every parsed command segment is explicitly allowed; explicit
        escalation/full-access omits the sandbox only when policy permits it; denied-read
        restrictions keep execution sandboxed; sandbox denial never triggers a silent unsandboxed
        retry. Commit(s): pending local changes
  - [x] Package native sandbox verification through an app-owned helper/test seam so unit tests
        exercise the helper contract instead of launching raw nested `sandbox-exec` from the
        Codex-hosted unit-test process. Commit(s): pending local changes
- [x] Grant the active session artifact directory as a writable root while treating that session's
      `immutable/` artifact child as a read-only subpath, without granting broad writable access to the
      configured artifact root or to artifacts owned by other sessions. Commit(s): pending local changes
- [x] Implement the Artifacts `svvyx` command and facade contract for empty artifact
      creation with exact `--name <filename.ext>`, copy creation with `--path` plus optional exact
      `--name`, `--immutable`, extension-required basename validation, collision rejection, and no
      `--kind`, implicit extension, inline content, or OS file-flag immutability. Commit(s): pending local changes
- [x] Keep cx out of generated `execute_typescript` facades; generated actor-specific `execute_typescript` declarations should not expose `api.cx_*` or `extensions.cx.*`. Commit(s): pending local changes
- [x] Record direct tool calls and nested `execute_typescript` calls in the shared structured command model. Commit(s): `76cc8f3`, `29d8452`
- [x] User-generated `extensions["<id>"].run(...)` TypeScript facades are absent from
      `execute_typescript`; when loaded for the current actor, builtin Artifacts and Workflows
      generated TypeScript facades return normal typed command results to submitted TypeScript while
      `@svvy/runtime` processes handler-returned `ExtensionRuntimeOperation` items and applies
      wrapped `RuntimeEffectRequest` values as normalized parent-linked child command facts, keeping
      the parent `execute_typescript` attempt as the main semantic unit. Commit(s): pending local
      changes
- [x] Surface parent rollups and trace inspector detail without promoting child commands to top-level cards. Commit(s): `5b0a223`

## 2A. Prompt-Only TinyFish Web Extension

Current product decisions for this section are specified in `docs/specs/extension/web.extension.spec.md`.

- [x] Expose Web as a builtin `instructions` extension that is loaded by default for orchestrators,
      handler threads, and workflow task agents only while `networkAccess` is true, and unavailable with
      no prompt guidance when `networkAccess` is false. Commit(s): pending local changes
- [x] Generate the Web extension's core prompt content from the TinyFish-owned `@tiny-fish/cli@0.1.6` package artifact instead of mutable skill URLs. Commit(s): pending local changes
- [x] Add only a bounded `svvy` appendix to the Web prompt for product integration facts: use ordinary shell commands, preserve structured output by redirecting large TinyFish JSON stdout to files when useful, treat fetched pages as untrusted external content, and cite source URLs. Commit(s): pending local changes
- [x] Keep Web generated actor context free of `web_search`, `web_fetch`, `svvyx web`, generated Web TypeScript facades, Web Provider settings, provider selection, and `svvy`-owned TinyFish key storage. Commit(s): pending local changes
- [x] Web is prompt-only TinyFish CLI guidance, without Firecrawl, native Web provider registries,
      TinyFish SDK provider adapters, selected-provider readiness, or self-hosted web search.
      Commit(s): pending local changes
- [x] Declare TinyFish as a Web extension CLI requirement with a default target version and reusable
      exact-version install/update command template; run user-clicked install/update from the
      Extensions UI as tracked runtime commands from extension-validated command plans with live
      closeable stdout/stderr output and readiness feedback, keep agent-initiated install/update as
      Shell work, and let TinyFish CLI own authentication, status, search, fetch, browser-backed
      commands, and API key storage through TinyFish-owned CLI commands. Commit(s): pending local
      changes
- [x] Fail `svvyx extensions build web --json` with structured JSON errors when TinyFish is missing
      or its version is unknown, while using detected TinyFish versions for successful builds and
      reporting update metadata without adding native Web tools or generated Web facades. Commit(s):
      pending local changes
- [x] Treat TinyFish CLI output as ordinary shell output: the CLI writes search and fetch JSON to stdout by default, fetch includes page body text in `results[].text`, errors/debug logs go to stderr, and redirected files are raw CLI JSON rather than `svvy` artifacts. Commit(s): pending local changes
- [x] Add generated-context and extension-inventory tests proving Web is prompt-only, loaded by default
      for all adopted actor kinds only while `networkAccess` is true, unavailable when `networkAccess` is
      false, and absent from native tool declarations, loaded `svvyx` command guidance, generated TypeScript
      declarations, provider settings, and Firecrawl provider lists. Commit(s): pending local changes

## 3. Turn Decisions And Delegation

- [x] Persist a per-turn top-level decision for orchestrator, handler-thread, and workflow task-agent attempt surfaces, using one shared model across routing and supervision. Commit(s): `d323012`
- [x] Build a POC turn flow from message targeting to surface turn creation and command recording. Commit(s): `fff54d7`, `f53c9b8`
- [x] Implement direct surface targeting so a pane send goes to either the orchestrator surface or a handler-thread surface. Commit(s): `f53c9b8`
- [x] Add `thread_start` as the orchestrator-side delegation primitive. Commit(s): `f53c9b8`
- [x] Expose the resolved thread-control runtime surface and generated prompt text: orchestrators get `thread_start({ threadGroupId?, threads })` with per-item `history` and `overrides`, `thread_followup({ activate? })`, `thread_list`, `thread_episodes`, and `thread_request_report`; handlers get `thread_current`, `thread_group`, `thread_report`, and `thread_episodes`; agent-facing prompts and runtime tool declarations contain only that thread-control surface. Commit(s): pending local changes
- [x] Implement minimal orchestrator routing for local reply, local `execute_typescript`, clarification, and `thread_start`. Commit(s): `d323012`
- [x] Re-enter orchestrator control from durable handler-thread episodes, using durable thread objective state plus the latest episode instead of raw transcript scanning. Commit(s): `d323012`, `fdaf460`

## 4. Handler Threads

- [x] Build a POC handler-thread spawn flow with objective handoff and a dedicated backing pi session. Commit(s): `f53c9b8`
- [x] Persist handler-thread objective state separately from handler activity, workflow activity, waits, and repair context, without flattening workflow failure or cancellation into thread objective conclusion. Commit(s): `f53c9b8`, `fdaf460`, `a02bd48`
- [x] Present handler-thread transcript cards as objective, current activity, latest report, and counts from structured read models instead of replacing the objective with latest report text. Commit(s): pending local changes
- [x] Let handler threads receive direct user messages through the same surface model as the orchestrator. Commit(s): `f53c9b8`
- [x] Make handler-thread clarification, waiting, and resume happen inside the thread itself instead of bouncing through the orchestrator by default. Commit(s): `f53c9b8`
- [x] Add runtime-level verification that handler-local command or Smithers failure can continue or rerun on the handler surface without an orchestrator turn unless the handler explicitly calls `thread_report`. Commit(s): pending local changes
- [x] Keep handed-back handler threads directly interactive for follow-up chat without forcing a new thread. Commit(s): `ba5c3f0`
- [x] Let a concluded handler objective move back to active through explicit orchestrator re-engagement with `thread_followup({ activate: true })`, preserving handler and workflow activity as derived facts. Commit(s): `f53c9b8`, `a02bd48`
- [x] Preserve earlier thread episodes when the same thread later returns control again. Commit(s): `d323012`
- [x] Allow the orchestrator to inspect a handler thread on demand without making that the default reconciliation path. Commit(s): `ba5c3f0`
- [x] Make `thread_report` the explicit handler-thread episode and conclusion path so ordinary handler replies stay interactive and multi-turn. Commit(s): `fdaf460`
- [x] Load orchestrator, handler-thread, and workflow task-agent attempt instructions through pi's true `systemPrompt` channel before sending each real prompt-bearing message. Commit(s): `8a41d08`
- [x] Surface the active system prompt as expandable surface metadata while keeping committed conversation history in pi session history rather than role-labelled prompt reconstruction. Commit(s): `8a41d08`
- [x] Slice generated capability declarations by actor so the orchestrator prompt receives only orchestrator-callable tools while handler-thread prompts receive only handler-callable tools. Commit(s): `a02bd48`
- [x] Teach the orchestrator prompt that workflow actions normally require delegation into a handler thread instead of direct Smithers guidance in the orchestrator API block. Commit(s): `a02bd48`
- [x] Teach handler-thread prompts that the orchestrator owns delegation and reconciliation while omitting orchestrator-only tool declarations such as `thread_start` unless nested delegation is explicitly adopted. Commit(s): `a02bd48`

## 5. Smithers CLI Boundary

Current product decisions for this section are specified in `docs/specs/extension/smithers.extension.spec.md`.

- [x] Keep Smithers as a builtin prompt-only extension scoped to official CLI and authoring guidance for handler threads, with no native Smithers tools, generated TypeScript facades, or bundled app Smithers runtime dependencies. Commit(s): pending local changes
- [x] Generate the Smithers core instruction fragment from the Extension Managing-selected `smithers-orchestrator` documentation version while excluding GUI, Gateway, MCP, HTTP server, OpenTelemetry, DevTools, event-streaming, OpenAPI, Effect, and wrapper-oriented fragments that are not current `svvy` product surfaces. Commit(s): pending local changes
- [x] Keep the svvy Smithers boundary instruction focused on workspace `.smithers/`, official `bunx smithers-orchestrator ...` CLI usage through Shell, official Smithers CLI operations, and reusable svvy workflow assets as Workflows-extension material. Commit(s): pending local changes
- [x] Keep orchestrators aware that workflow action normally delegates into handler threads, while handler threads load by default Smithers prompt guidance and workflow task agents do not load by default Smithers. Commit(s): pending local changes

## 6. Workflows Source, Build, And Generated Surface

Current product decisions for this section are specified in `docs/specs/workflow-library.spec.md` and `docs/specs/extension/workflows.extension.spec.md`.

- [x] Store app-global reusable Workflows source under `~/.config/svvy/workflows/agents`, `prompts`, `components`, and `workflows`, while generated `@svvyx/workflows` and `@svvyx/extensions` roots are app-owned generated output locations resolved through `GeneratedPackageRootPort`, not source-library children. Commit(s): pending local changes
- [x] Treat generated `@svvyx/workflows` and `@svvyx/extensions` output plus workspace `.smithers/node_modules/@svvyx/*` links as read-only plumbing outside the safe writable boundary; ordinary edits target source and then build. Commit(s): pending local changes
- [x] Generate `@svvyx/workflows` with only `Agents`, `Components`, `Prompts`, and `Workflows` root namespaces, and export `Agents.defineTaskAgent` plus generated authoring type `Agents.TaskAgentParametersSource` under `Agents`. Commit(s): pending local changes
- [x] Link `@svvyx/workflows` and generated `@svvyx/extensions` into each opened workspace's `.smithers/node_modules` without relying on ambient global package resolution, `NODE_PATH`, parent repository `node_modules`, or source-checkout-relative paths. Commit(s): pending local changes
- [x] Generate `@svvyx/extensions` during the Workflows build path from workflow-task-safe builtin ids plus file/build-eligible user `svvyx` extensions that opt into workflow task-agent reference export generation, have approved dependencies, and have successful current source/build evidence; reject workflow-agent overrides for deleted, instruction-only, dependency-missing, or build-failed extension ids. Commit(s): pending local changes
- [x] Implement `svvyx workflows list [--kind agent|prompt|component|workflow] --json` with only mechanically available export identity and source/generated paths. Commit(s): pending local changes
- [x] Implement `svvyx workflows save --from <path> --kind agent|prompt|component|workflow [--export <name>] --as <exportName> [--overwrite] --json`, with strict overwrite rejection by default and an `ExtensionHandlerResult` containing a model-facing command result plus one ordered `generated_packages.refresh` `RuntimeEffectRequest` operation after successful source write. Commit(s): pending local changes
- [x] `svvyx workflows build --json` returns a model-facing result plus an ordered
      `generated_packages.refresh` runtime-effect request; `@svvy/runtime` applies that request,
      calls `@svvy/extensions` to build `@svvyx/extensions` and `@svvyx/workflows`, records
      generated-package facts through `@svvy/state`, then schedules separate workspace-link repair
      workers after those facts commit. Commit(s): pending local changes
  - [x] Preflight app-owned user Extension source before Workflows source validation so invalid Extension build inputs and TypeScript-enabled `svvyx` extensions that cannot rebuild fail with Extension-specific diagnostics before `@svvyx/extensions` or `@svvyx/workflows` package writes. Commit(s): pending
  - [x] Add automatic Extension rebuild and dependency/CLI-aware outcomes to the Workflows build pipeline before workflow-agent extension usage overrides are accepted. Commit(s): pending
- [x] Implement `svvyx workflows models list --json` from the same pi-normalized provider/model/auth/reasoning metadata used by the Agents pane, without a live completion request by default. Commit(s): pending local changes
- [x] Store reusable task-agent parameters as structured `.agent.json` source records that are bidirectionally synchronized with the Agents pane and generated as `Agents.*` exports. Commit(s): pending local changes
- [x] Save `--kind agent` by statically extracting namespace-qualified `Agents.defineTaskAgent(...)` parameter literals without executing arbitrary TypeScript; reject dynamic, unresolved, or root `defineTaskAgent(...)` inputs with structured diagnostics. Commit(s): pending local changes
- [x] Record Workflows export metadata in generated-package facts/read models for UI source/generated links; generated `@svvyx/workflows` runtime exports carry no app metadata, public metadata fields, public declarations, `__exports`, private metadata symbols, or changed import usage for agents. Commit(s): pending local changes
- [x] Render the Workflows pane as read-only visibility into generated `@svvyx/workflows`, with export identity, read-only generated code, generated-file link, source-file link, and Agents-pane customization links for `Agents.*`. Commit(s): pending local changes
- [x] Generated `@svvyx/workflows` task-agent clients validate bridge success responses before
      returning `RunTaskAgentResult` and fail malformed success JSON with a clear bridge error.
      Commit(s): pending local changes
- [ ] Workflow task-agent execution enters runtime through a durable handler-owned queue row and
      the narrow generated `runTaskAgent` bridge path; app/bootstrap only hosts the command-scoped
      transport binding and facade wiring.

## 8. Workspace Navigation, Live Surfaces, And Core Projection

Current product decisions for this section are specified in `docs/specs/workspace-navigation-core-projection.spec.md`.

- [x] Drive the session sidebar entirely from durable workspace session summaries. Commit(s): `9a21f87`, `b0ee858`
- [x] Define the stored shape for pinned and archived sessions, including the default collapsed state for the single Archived group. Commit(s): `3855fe4`
- [x] Persist pinned and archived session state. Commit(s): `3855fe4`
- [x] Render pinned sessions at the top of the active session list. Commit(s): `3855fe4`
- [x] Render archived sessions inside one Archived group in the session sidebar. Commit(s): `3855fe4`
- [x] Persist the Archived group collapsed state per workspace. Commit(s): `3855fe4`
- [x] Add session row actions for pin, unpin, archive, and unarchive. Commit(s): `3855fe4`
- [x] Keep durable unread state session-level with sidebar timestamp dots, focus-to-read clearing, and session row context-menu actions for mark read or unread, pin, rename, archive, and confirmed delete; pane unread treatment, when present, reads from the same session metadata. Commit(s): pending local changes
- [x] Join session summaries, focused panel, and panel-to-surface bindings in one workspace-shell read model without depending on a global active surface. Commit(s): `9a21f87`, `b0ee858`
- [x] Keep workspace summaries and live transcript patches as separate state/runtime surfaces:
      workspace summaries come from `@svvy/state` read models, live transcript patches come from
      `@svvy/runtime` event streams, and `@svvy/desktop` caches them only as non-authoritative view
      state. Commit(s): `9a21f87`, `b0ee858`
- [x] Render open live-surface registry state from state-backed read models plus runtime live-surface
      notifications/facade snapshots keyed by `surfacePiSessionId`. Commit(s): `9a21f87`,
      `b0ee858`
- [x] Render each live surface from state-backed surface read models plus runtime-owned prompt-lock,
      model, reasoning, and cancellation lifecycle notifications. Commit(s): `9a21f87`,
      `b0ee858`
- [x] Render handler-thread rows from structured state in the workspace shell while keeping lifecycle subtitles, active command summaries, running indicators, open-pane treatment, and compact context rails local to the owning row. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`, pending
- [x] Show thread objective, objective state, and row-local derived blocked reason in panel-local thread views. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render the latest thread episode for an inspected thread while preserving earlier episodes in thread history. Commit(s): `ba5c3f0`, `9a21f87`, `b0ee858`
- [x] Render thread-linked artifacts before relying on transcript reconstruction. Commit(s): `3855fe4`
- [x] Restore focused panel, panel-to-surface bindings, and inspector selection after restart. Commit(s): `3855fe4`
- [x] Keep open workspaces as left-aligned, horizontally scrollable, draggable app-chrome tabs with durable user-defined tab order, compact icon controls, >0-only colored status count badges, a svvy-owned default workspace runtime when no user workspace tabs restore, current-tab `Open Workspace`, `New Tab` as a new default workspace tab over the shared default runtime and selected durable layout slot, and `Open Workspace in New Tab` as picker-backed user workspace tab creation; duplicate same-cwd tabs are separate chrome views over the same `@svvy/runtime` workspace runtime, session catalog, durable workspace state, live surface registry, queues, threads, app logs, generated Workflows export read models projected from generated-package facts, and durable layout slots keyed by `(workspaceId, layoutId)`, while each tab stores only its selected active layout id. Commit(s): pending local changes
- [x] Route all workspace-scoped runtime/state facade requests and typed notifications through
      explicit `workspaceId` instead of process-global cwd, active workspace, focused tab, or active
      runtime; keep app-global settings and app-global Workflows source-library operations on
      separate app-global APIs; require explicit `workspaceId` only for workspace-affecting settings,
      generated agent-context projections, command context, and workspace package-link repair.
      Commit(s): pending local changes

## 9. Command Palette And Quick Open

Current product decisions for this section are specified in `docs/specs/command-palette.spec.md`.

- [x] Define the product-owned command/action registry shape, including stable ids, labels, aliases, categories, availability, shortcuts, and typed execution targets. Commit(s): `cb319ac`
- [x] Define the shared VS Code-style palette shell where `Cmd+Shift+P` opens with `>` prefilled and `Cmd+P` opens the same input without a prefix. Commit(s): `cb319ac`
- [x] Define `>` as the live command-mode prefix for session, surface, handler-thread, Workflows, Dockview panel, settings, Agents profile, and spec-backed product actions. Commit(s): `cb319ac`
- [x] Define unprefixed `Cmd+P` behavior as file quick-open search with placeholder or no-op behavior until file-tree, editor, syntax-highlighting, typecheck, and diagnostics surfaces exist. Commit(s): `cb319ac`
- [x] Adopt `cmdk-sv` as the Svelte command palette UI primitive while keeping product routing and command semantics owned by `svvy`. Commit(s): `cb319ac`
- [x] Build a POC command palette over static product actions. Commit(s): `cb319ac`
- [x] Expose session creation, open/switch, pin, unpin, archive, and unarchive actions through the palette. Commit(s): `cb319ac`
- [x] Show unified `Open Session` results for orchestrator, handler-thread, and workflow task-agent projection categories with visible kind badges. Commit(s): `12d89d8`
- [x] Route unmatched non-empty command-mode text after `>` into a New orchestrator initial prompt through the normal orchestrator turn model. Commit(s): `cb319ac`
- [x] Add keyboard shortcut handling for `Cmd+Shift+P`, `Cmd+P`, Enter, and command-palette `Cmd+Enter` placement once Dockview layout exists. Commit(s): `cb319ac`
- [x] Add tests for shortcut dispatch, command matching, action routing, disabled or hidden availability, and unmatched prompt-session creation. Commit(s): `cb319ac`
- [x] Keep a product-owned shortcut registry with stable action ids, labels, platform chords, compact and readable display strings, scopes, input-typing policy, and app-menu routing metadata, while command availability and palette result metadata stay on product action definitions. Commit(s): pending
- [x] Use TanStack Hotkeys as the renderer shortcut dispatch primitive for palette, quick-open, sidebar shell actions, dialog-local actions, pane placement, and focused-pane actions. Commit(s): pending

## 10. Pane Layout, Surface Ownership, And Expanded Surfaces

Current product decisions for this section are specified in `docs/specs/pane-layout.spec.md`.

- [x] Add `dockview-core` as the workspace layout engine and mount one Dockview workbench instance from the Svelte renderer. Commit(s): pending local changes
- [x] Build the Svelte renderer adapter for Dockview content, tabs, header actions, context menu items, tab-group chips, watermark, and unavailable-surface panels. Commit(s): pending
- [x] Add Settings as a Dockview-bindable pane target and renderer branch. Commit(s): pending
- [x] Persist Dockview serialized layout state plus svvy panel metadata, including panel-to-surface bindings, panel-local state, chrome state, restore state, and minimum panel policy. Commit(s): pending local changes
- [x] Persist fixed workspace layout slots `A`, `B`, and `C` keyed by `(workspaceId, layoutId)`, with the selected slot autosaved on pane changes and empty user-workspace slots rendered as muted but selectable controls pinned at the far right of workspace chrome; default workspace slots use the same persistence model, with an empty selected default-workspace slot seeded by exactly one `Open Workspace` pane. Commit(s): pending local changes
- [x] Keep panel-to-surface bindings separate from live surface runtime state. Commit(s): pending local changes
- [ ] Support Dockview split, splitter resize, close, tab placement, panel and group drag placement, root-edge placement, edge groups, floating groups, and popout groups through svvy placement commands.
  - [x] Preserve tab, root-edge, floating, and popout placement intent through renderer-local commands that submit durable Dockview layout and panel-binding updates to `@svvy/state`; the desktop/Dockview adapter consumes the resulting read models and applies Dockview placement options. Commit(s): pending local changes
  - [x] Expose command-palette placement actions for the current pane's surface into left/right/above/below splits, left/right/top/bottom root edges, floating groups, and popouts through the desktop action registry over Dockview layout state; runtime owns only live surface attach/release lifecycle. Commit(s): pending
  - [x] Derive command-safe Dockview tab-group targets from serialized layout state and expose `pane.place-tab.<groupId>` placement commands through the desktop action registry over Dockview layout state. Commit(s): pending
  - [ ] Add explicit resize commands once the product has a stable command target-selection contract for Dockview-owned groups and splitters.
- [x] Configure Dockview drag/drop overlays and `dndEdges`, with svvy policy enforced through `onWillShowOverlay`, `onWillDrop`, `onDidDrop`, and `onUnhandledDragOverEvent`. Commit(s): pending local changes
- [x] Manage explicit open and close semantics for live surfaces independently from Dockview panel focus. Commit(s): pending local changes
- [x] Allow the same interactive surface to be opened in more than one Dockview panel at once. Commit(s): pending local changes
- [x] Keep one underlying live surface controller per `surfacePiSessionId` regardless of panel count. Commit(s): pending local changes
- [x] Persist Dockview layout JSON, panel occupancy, panel-local state, tab-group state, edge-group state, floating/popout state, and panel metadata across app restart. Commit(s): pending local changes
  - [x] Persist and restore static-pane tab, root-edge, floating, and popout placement metadata through workspace UI restore state. Commit(s): pending local changes
  - [x] Restore mixed runtime layout state for serialized Dockview JSON, prompt and static pane bindings, focused panel id, panel-local scroll and density, and edge/floating/popout placement metadata. Commit(s): pending
  - [x] Add mounted Dockview verification that `fromJSON` restores edge and floating groups while preserving svvy's saved focused panel state in the real Svelte adapter. Commit(s): pending
  - [ ] Verify mounted popout restore through a test harness lane that can observe startup popout
        windows directly, without relying on ordinary panel synchronization from the main window.
- [x] Restore the focused Dockview panel on app restart. Commit(s): pending local changes
- [x] Show exact Dockview panel-location indicators in the sidebar for open surfaces, including tab, edge-group, floating, and popout locations. Commit(s): pending local changes
- [x] Show a clear highlight for the currently focused Dockview panel surface. Commit(s): pending local changes
- [x] Define the stored shape for compact thread surfaces inside the workspace shell. Commit(s): pending local changes
- [x] Render compact thread cards in the workspace shell timeline. Commit(s): pending local changes
- [x] Open a selected handler-thread surface in a chosen Dockview panel as a fully interactive surface. Commit(s): pending local changes
- [x] Keep duplicated panel views of the same surface synchronized while allowing independent scroll position. Commit(s): pending local changes

## 11. Agents Pane And Agent Profiles

- [x] Define the stored shape for pi-backed agent profile settings used by orchestrator, handler, and workflow task-agent attempt surfaces. Commit(s): `8e19462`
- [x] Keep agent profiles separate from session-local extension loading so specialized handler guidance uses normal handler-thread execution plus loaded extensions. Commit(s): `2a5dbbe`
- [x] Seed initial app-wide values for the default orchestrator profile, the `threadHandler` profile, and internal title-naming settings. Commit(s): `8e19462`, `354db28`
- [x] Build a POC settings model for editing app-wide agent profile defaults. Commit(s): `8e19462`
- [x] Persist app-wide agent profile settings. Commit(s): `8e19462`
- [x] Build a POC New orchestrator creation flow with profile-backed orchestrator selection. Commit(s): `8e19462`
- [x] Persist the orchestrator profile snapshot and prompt selection used by created sessions. Commit(s): `8e19462`
- [x] Persist per-session orchestrator profile overrides. Commit(s): `8e19462`
- [x] Persist and deliver handler start history mode for delegated handler threads, defaulting `thread_start.threads[].history` to `isolated` and supporting explicit `forked` starts only for conservative continuity cases where the user asks for current conversation context, unresolved design nuance cannot be captured in durable files or a compact objective, or multiple approaches must start from the exact same conversational point. Commit(s): pending local changes
- [x] Persist handler creation-time extension-state overrides for delegated handler threads as partial overrides over the `threadHandler` profile. Commit(s): pending local changes
- [x] Keep the Agents sidebar pane between Logs and Extensions, with orchestrator profiles plus the `threadHandler` special profile owned there instead of in General settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Drive the New orchestrator picker order, profile-specific command palette actions, and surface profile badges from Agents-pane orchestrator profile order. Commit(s): `2b97c46648`, `031510ba2b`
- [x] Keep the default orchestrator profile locked, first, non-draggable, non-deletable, and editable for settings. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Keep the `threadHandler` special profile available for delegated handler-thread surfaces. Commit(s): `2b97c46648`, `b714aa26f9`
- [x] Show the current focused-surface agent profile summary in pane chrome. Commit(s): `8e19462`
- [x] Use TanStack Form for complex settings forms where renderer-local validation and save state are needed. Commit(s): pending
  - [x] Provider API key entry and app-preference settings use TanStack Form with validation, dirty state, reset/cancel, pending submit state, async save errors, and `@svvy/state`-normalized reset defaults. Commit(s): pending
  - [x] Agent-profile and workflow-agent parameter editors use TanStack Form while preserving direct-save semantics, workflow-agent instruction autosave status inside the textarea, and pi-normalized provider/model/reasoning constraints. Commit(s): pending
  - [x] Extension env editors cover editable non-secret overrides and secret writes/removals through app-owned UI with redacted async errors and `@svvy/extensions`-authoritative readiness refresh. Commit(s): pending
- [x] Expose workflow-agent parameter records in the Agents pane through the same source used for `Agents.*` generated Workflows exports, with create, duplicate, user-delete, non-deletable default Explorer/Implementer/Reviewer records, source-file links, and the same expanded extension selection/order editor used by other agent profiles. Commit(s): pending
- [x] Keep Agents-pane profile and workflow-agent controls visually stable during transient save/autosave states, using save indicators and action-level guards instead of dimming unrelated row controls. Commit(s): 5de117401
- [x] Define handler guidance for reusable workflow-agent parameter records without coupling shipped product workflow authoring to repo-root `workflows/`. Commit(s): pending local changes

## 12. Session Titles

- [x] Define the stored title states for top-level sessions and handler threads. Commit(s): `b510857`, `fe53a3b`
- [x] Add internal pi-backed title-naming settings for one-shot top-level session naming rather than a Smithers workflow agent. Commit(s): `354db28`
- [x] Seed the internal title-naming settings to `openai-codex`/`gpt-5.4-mini` with low reasoning effort and treat its settings prompt as the only naming instruction, without exposing title naming as a special profile. Commit(s): `354db28`
- [x] Build a POC event-driven title-generation flow that starts a durable one-shot naming job concurrently with the first real top-level user turn without waiting for the orchestrator response. Commit(s): `354db28`
- [x] Use the first live composer draft or first submitted user message as the provisional visible session title until the namer-generated title lands. Commit(s): `5378dcb`
- [x] Persist generated top-level session titles, title-generation lifecycle state, and the first-turn trigger so app restart cannot duplicate or lose title generation. Commit(s): `354db28`
- [x] Block manual session rename while a title-generation job is pending or running, then release the lock after success, failure, or cancellation. Commit(s): `354db28`
- [x] Freeze auto-titling after manual rename or after the first successful generated title. Commit(s): `354db28`
- [x] Generate handler-thread titles with the same internal title-naming settings used for top-level sessions, using the orchestrator-supplied `thread_start` objective as the naming input. Commit(s): `4d74c78`

## 13. Composer Mention Links

- [x] Define the stored shape for composer file and folder mention links.
- [x] Build a POC `@` autocomplete picker over indexed workspace files and folders.
- [x] Keep selected `@` mentions as normal inline composer text.
- [x] Render picker, dropped, and pasted files as removable chip-only composer attachments without mutating textarea text.
- [x] Store file, folder, and image attachments for composer and transcript rendering, pass attachment paths through tagged agent-facing metadata without visible transcript prose, send images to pi as image content blocks, and warn when model metadata does not list image input.
- [x] Save composer draft text and chip-only attachments live as durable surface state that survives closing the surface and app restart. Commit(s): `5378dcb`
- [x] Serialize inline mentions into the outgoing user message as normal workspace path links.
- [x] Render sent mentions in the transcript as actionable workspace links that reveal files, open folders, and visibly mark missing paths.
- [x] Keep mentions agent-neutral: no prompt injection, no eager file reads, no folder expansion, and no special context-target resolution.

## 13A. Queued Surface Messages

Current product decisions for this section are specified in `docs/specs/queued-messages.spec.md`.

- [x] Persist durable surface queue items as structured surface-local product state keyed by `workspaceSessionId`, `surfacePiSessionId`, optional `threadId`, kind, and FIFO queue position. Commit(s): pending
- [x] When a composer submits to an active orchestrator or handler-thread surface, queue the message for that same surface instead of steering the current turn, interrupting tool work, starting a concurrent turn, or retargeting to the focused panel. Commit(s): pending
- [x] Deliver queued messages as the next real pi user message after the owning surface prompt lock releases, creating a normal turn record and preserving prompt history as a single queue-time submission. Commit(s): pending
- [x] Project blocked prompt-bearing queue items near the owning surface composer, including count, order, remove, restore-to-composer, and duplicated-panel consistency, while idle-surface prompt-bearing items first appear as pending or active work after atomic claim. Commit(s): pending
- [x] Project pre-turn delivery failures as queue-row-local failed items instead of normal failed turns, implicit queue restoration, or implicit queue cancellation. Commit(s): pending
- [x] Restore queued messages after app restart without transcript inference and resume delivery only after the owning surface runtime and prompt lock state are reconstructed. Commit(s): pending
- [x] Claim queued messages atomically through one shared queue runner per `surfacePiSessionId` and prevent duplicated panes or tabs from starting duplicate `@svvy/runtime` queue drains. Commit(s): `45bdbe8b46`
- [x] Use separate durable queue insertion and dispatcher claim transitions for idle-surface sends, with UI state derived from authoritative queue and surface read models after runtime notifications. Commit(s): pending
- [x] Keep queued-message drag reorder previews local until drop, persist only final changed order, and skip no-op durable reorder writes. Commit(s): `98c73ecbb6`
- [x] Represent handler reports as durable episode records that schedule typed `thread_report` orchestrator reconciliation notifications; notification dismissal does not roll back the episode or return a handler tool error. Commit(s): 7739c2c824
- [x] Represent generated agent context refresh as fingerprinted runtime state, apply stale opted-in refreshes after queue claim and before prompt-bearing dispatch, and expose extension-changed/out-of-date recovery UI without renderer-visible context-refresh queue rows. Commit(s): 61ba639d6a
- [x] Let committed user transcript messages enter composer edit mode with a visible selected-message indicator and a draft-replacement warning, then resend by moving the same pi surface back to the original message's parent state before continuing from the edited user message. Commit(s): `5378dcb`

## 14. Agents, Extensions, And Generated Agent Context

Current product decisions for this section are specified in `docs/specs/extensions-and-tools.spec.md`, `docs/specs/extension/extension_managing.extension.spec.md`, `docs/specs/extension/svvyx-incur-runtime.spec.md`, `docs/specs/structured-session-state.spec.md`, `docs/specs/queued-messages.spec.md`, `docs/specs/extension/smithers.extension.spec.md`, and `docs/specs/extension/workflows.extension.spec.md`.

- [x] Define builtin extensions for Shell, Apply Patch, Execute TypeScript, Extension Loading, Extension Managing, cx, Smithers, Workflows, Web, Git, GitHub, External Instructions, Artifacts, and Request User Input with default usage states for each adopted agent family. Commit(s): `673837a`
- [x] Load base orchestrator, handler, and workflow-task guidance through builtin `base-*` instruction extensions, with orchestrators aware that workflow action normally delegates into handlers, handlers loaded by default with prompt-only Smithers guidance and Workflows source-library commands, and workflow task agents keeping Smithers, Workflows, and handler controls configured off by default but still configurable through profile overrides. Commit(s): `673837a`
- [x] Define available extensions as the on-demand product-knowledge and capability layer for specialized handler work. Commit(s): `2a5dbbe`
- [x] Render loaded and available extension bindings in surface metadata so users can see when specialized extensions are active. Commit(s): `2a5dbbe`
- [x] Store app-wide agent profiles, extension usage selections, generated agent-context aggregate references, extension context fingerprints, and app-global extension activation metadata. Commit(s): `118fd39c9f`
- [x] Add an `Extensions` sidebar surface below `Agents`, with builtin, user, and external-instruction records that manage reusable prompt material and capabilities rather than exposing one raw system-prompt textarea. Commit(s): `118fd39c9f`
- [x] Represent common, orchestrator, handler-thread, and workflow task-agent base prompts as builtin instruction-only extensions (`base-common`, `base-orchestrator`, `base-handler`, and `base-workflow-task`) with normal Extensions-pane editing, reset, generated-context preview, fingerprinting, and profile usage-state controls. Commit(s): pending local changes
- [x] Seed builtin extension records for base actor instructions, code navigation, prompt-only Smithers guidance, Workflows source-library commands, workflow task boundaries, Web, Git, GitHub, Artifacts, and Request User Input, with per-agent usage states, non-deletable builtin rows, app-global scope, and extension reset behavior. Commit(s): `118fd39c9f`
- [x] Render generated agent-context previews for orchestrator, handler, and workflow task-agent actors, linking loaded and available extension rows back to their extension records and showing generated prompt, `svvyx` guidance, native schemas, and TypeScript declaration previews. Commit(s): `118fd39c9f`
- [x] Show tokenx-backed generated prompt token estimates in expanded Agents rows, with active extension rows showing aligned generated instruction estimates, available rows showing available-prompt estimates plus would-be loaded-prompt estimates in parentheses, Off rows omitting counts, expanded workflow-agent inline instruction rows showing live draft estimates beside their source file link, and the total actor prompt estimate visible beside reset controls while including the current workflow-agent inline instruction draft. Commit(s): pending local changes
- [x] Create app-owned user extension skeletons through `svvyx extensions create`, with `instructions` and `svvyx` interfaces, neutral instruction files, an Incur default-export source skeleton for `svvyx`, manifest-backed inspect/build visibility under the same app-owned root, initial draft/build-required state, and rejection for builtin, reserved, manifest-collision, duplicate, invalid, and native-tool targets. Commit(s): pending local changes
- [x] Manage user extension full instruction files through `svvyx extensions instructions add`, `rename`, `remove`, `reorder`, and `configure`, with app-owned file/config-only mutations, lexicographic file ordering, skip config stored in the editable manifest, deterministic reorder prefix renames, before/after lifecycle change records, focused validation, and dirty build state that leaves the current successful build active until the next successful build. Commit(s): pending local changes
- [x] Revert recorded instruction lifecycle changes through `svvyx extensions revert <change-id> --json`, with exact current-state conflict detection, `extension_files` `revertedChangeId`/`changeId` output, reverted file facts including manifest-only config changes, a follow-up change record for the revert, and an immediate same-build-path auto-build projection that reports success, blocked build errors, or durable dependency approval pauses. Commit(s): pending local changes
- [x] Delete user extensions through `svvyx extensions delete <id> --json` by recording an app-global reversible delete change before moving local source into trash, rejecting builtin deletes, blocking stale `svvyx` runtime dispatch for deleted current builds, and restoring deleted source through `svvyx extensions revert <change-id> --json` with active-source collision and build-required handling. Commit(s): pending local changes
- [x] Manage local Extension Managing snapshots through `svvyx extensions snapshots list/save/rename/delete --json`, with path-free snapshot summaries, app-generated ids, source/package/registry-state payload capture, and exclusion of generated outputs, build outputs, `node_modules`, and unsafe path/token-bearing package files. Commit(s): pending local changes
- [x] Build user extension contexts through staged Extension Managing builds that promote successful output to `current/`, preserve the previous current build on validation failures, report manifest env/dependency/trusted-dependency declarations in inspect/build readiness, keep env output status-only and redacted, split `contextReady` from `runtimeReady` for missing required env and unapproved dependency declarations, block missing or unknown required CLI requirements before promotion, validate exact dependency versions, generated-instruction declarations, instruction config references, env defaults, and `svvyx` source shape, and refuse generated-instruction activation until generator execution is implemented. Commit(s): pending local changes
- [x] Record explicit Extension Managing build dependency approval requests in an app-global durable ledger keyed by exact dependency and trusted-dependency identities, pause those builds before staging promotion with a durable approval request id, reuse pending requests for repeated builds with the same unapproved identity set, project existing pending request ids through later inspect/readiness output, retire stale requests when the extension no longer requires those identities, and require new approval when the exact dependency or trusted dependency identity changes. Commit(s): pending local changes
- [x] Resume blocked Extension Managing install/build work after dependency approval, install approved extension package dependencies from the app-owned package area with lifecycle scripts disabled unless the exact trusted dependency identity is approved, preserve current builds on install failure, and project exact installed/missing package artifact status. Commit(s): pending local changes
- [x] Manage app-global extension env values with non-secret app-level overrides in agent settings plus secret entry, update, and removal through the Extensions pane backed by macOS Keychain storage; Extension Managing and inventory report only declaration metadata and configured/missing/defaulted status, while `svvyx` runtime dispatch injects values only for the trusted extension invocation and redacts secret stdout. Commit(s): pending local changes
- [x] Project builtin extension CLI readiness into the Extensions pane from the same Extension Managing inspect/build readiness facts, including missing, unknown, available, detected/current/default/latest versions, update-available status, and install/update command facts without renderer-side CLI probing. Commit(s): pending local changes
- [x] Project reversible Extension Managing change cards into the Extensions pane from the same lifecycle, usage, and delete change records used by `svvyx extensions revert <change-id> --json`, with UI-triggered reverts submitted through the bootstrap-provided runtime facade's Extension Managing revert path and refreshed from `@svvy/state` read models. Commit(s): pending local changes
- [x] Dispatch built user `svvyx` extensions through the runtime-owned command lifecycle: Shell `svvyx ...` and generated facade calls resolve current build manifests through the `@svvy/extensions` svvyx dispatch service, validate installed dependency package artifacts before invocation, run trusted Incur command implementations with invocation-local env, redact secret output, record structured readiness or command-failure facts, and avoid treating extension usage state as a shell-level command block. Commit(s): pending local changes
- [x] Extract Incur command manifests during successful user `svvyx` extension builds, persist them in current build metadata, and reject malformed command-manifest current builds before runtime dispatch or generated declaration emission. Commit(s): pending local changes
- [x] Manage orchestrator and `threadHandler` profile extension usage through `svvyx extensions set-usage`, with persistent tri-state profile usage, fixed always-loaded Extension Loading, app-global reversible usage change records, exact usage-revert conflict detection, profile-backed inspect usage output, and affected-surface reporting without directly mutating the caller's current binding. Commit(s): pending local changes
- [x] Manage Extensions-pane source editing, default order, duplicate/delete/reset controls, draggable default ordering, inventory filters, customized builtin tags, composable editable minimal instructions, loaded source contributors, scripted instruction contributors with editable generator scripts plus read-only generated output, external instructions as read-only discovered sources, tooling sections for native tool schema, `svvyx` command schema, and generated `execute_typescript` facade declarations, file-backed instruction editing with conflict handling, per-contributor skip controls, add/remove/reorder loaded-source lifecycle, app-owned trash for removed instruction files, and snapshots that preserve local source, default order, and default state. Commit(s): pending local changes
- [x] Rebuild builtin local source resets through the same Extension build path used by explicit builds, surfacing successful or blocked auto-build projections in reset output and command facts. Commit(s): pending local changes
- [x] Load local Extension Managing snapshots through `svvyx extensions snapshots load <snapshot-id> --json` by restoring local source/config/package state, removing live source entries absent from the snapshot, excluding package `node_modules`, immediately attempting restored extension builds through the normal build path, and creating or reusing durable dependency approval requests with `blockedOperation: "snapshot_load"` before promotion when unapproved dependency identities are present. Commit(s): pending local changes
- [x] Preserve local Extension Managing snapshot secret state through app-managed secret storage on snapshot save/load/delete, report only coarse `hasSecretState` and restore status, and keep raw secret values plus internal snapshot secret storage ids out of command output and snapshot files. Commit(s): pending local changes
- [x] Mark existing orchestrator, handler, and workflow task-agent attempt surfaces stale by fingerprint after successful Extension Managing snapshot load, and drop removed user extensions from their stored loaded/available extension ids before the next opted-in safe prompt-bearing pre-dispatch refresh. Commit(s): pending local changes
- [x] Keep existing current builds intact when snapshot-loaded replacement source fails to bundle, report a structured blocked build result, and skip loaded-session refresh for the failed replacement. Commit(s): pending local changes
- [x] Complete the `svvyx` runtime surface with packaged executable availability, full
      `@svvy/extensions`-owned `@svvyx/extensions` generation, dependency-approved package
      resolution, extracted Incur command manifests, no user generated TypeScript facades in
      `execute_typescript`, workflow-agent tri-state extension usage for `set-usage`, and live
      projection/recovery coverage. Commit(s): pending local changes
- [x] Extend Extension Managing lifecycle to conversation-owned UI revert events backed by durable session/thread lifecycle records and transcript semantic projection. Commit(s): pending
- [x] Store user-named Extension Managing snapshots plus durable generated agent context bindings and agent context fingerprints so historical sessions, handler threads, and workflow task-agent attempts remain inspectable after app restart. Commit(s): pending local changes
  - [x] Persist local Extension Managing snapshot save/list/rename/delete metadata and payloads, plus actor surface loaded/available extension ids and generated context fingerprints. Commit(s): pending
  - [x] Store durable generated-context binding records with aggregate cache keys plus bound prompt, `svvyx` guidance, TypeScript declarations, native tool schemas, loaded/available extension ids, and external source hashes so historical surfaces can inspect their bound context after restart even when current extension/external-instruction sources change or aggregate cache blobs are pruned. Commit(s): pending local changes
  - [x] Implement Extension snapshot load with local source/config/package restore and normal build/dependency-approval pause flow. Commit(s): pending local changes
  - [x] Implement local Extension snapshot secret-state preservation through app-managed secret storage with coarse save/load status and delete cleanup. Commit(s): pending local changes
  - [x] Implement loaded-session fingerprint staleness and removed user-extension state cleanup after successful snapshot load. Commit(s): pending local changes
  - [x] Implement dependency-approval resume/install completion after explicit build and snapshot-load approval pauses, with installed artifact validation and snapshot resume conflict protection. Commit(s): pending local changes
- [x] Add automatic generated agent context refresh for existing orchestrator, handler-thread, and workflow task-agent attempt surfaces through fingerprint-only stale detection, a checked-by-default update-before-next-turn intent, and `@svvy/runtime` safe prompt-bearing pre-dispatch enforcement. Commit(s): pending local changes
  - [x] Project stale generated context as the “Extensions changed and will require system prompt to refresh.” banner with the durable per-surface checkbox, without visible queue rows. Commit(s): pending local changes
  - [x] Commit generated-context binding facts in state transactions, return after-commit invalidation descriptors, and let runtime publish read-model invalidations only after successful automatic safe prompt-bearing pre-dispatch refreshes. Commit(s): pending local changes
- [x] Route `thread_start` extension overrides and handler-side `load_extension` through generated agent context bindings while preserving durable loaded and available extension ids on each affected surface. Commit(s): pending

## 14A. Ambient Agent Resources

Current product decisions for this section are specified in `docs/specs/ambient-agent-resources-baseline.spec.md`.

- [x] Add provider-neutral Ambient Agent Resources settings that default behavior-changing coding-agent host resources off, preserve visible runtime standards, and persist user-scoped host, workspace, target agent/profile, category, and source enablement records for callable capabilities, extensions/packages, skills, prompt templates, commands, hooks, UI resources, provider/model adapters, credentials, and execution-policy resources. Commit(s): pending local changes
  - [x] Persist the disabled-by-default category ledger without letting that ledger affect prompts, tools, commands, UI, provider/auth behavior, or execution policy until the full enablement model exists. Commit(s): pending
  - [x] Persist normalized host, source, app/workspace scope, category, and actor/profile enablement records for ambient resources without letting those records affect runtime behavior. Commit(s): pending
  - [x] Add a pure resolved-binding helper that returns enabled ambient candidates only when category, source, scope, actor, and profile all match. Commit(s): pending
- [x] Implement the baseline pi adapter so orchestrator, handler-thread, and workflow task-agent loaders preserve `AGENTS.md`/`CLAUDE.md`, ignore `SYSTEM.md`/`APPEND_SYSTEM.md`, and keep behavior-changing ambient extensions, skills, prompt templates, themes, package resources, slash commands, hooks, provider adapters, and related settings disabled until enabled through exact category/source/workspace/profile contracts. Commit(s): pending local changes
  - [x] Create managed pi actor sessions with default-deny resource loading, svvy-composed system prompts, empty agent files and append prompts, no host extensions/skills/prompt templates/themes/additional paths/factories, suppressed pi built-in tools, svvy-owned custom tools only, disabled prompt-template expansion, and no ambient `extendResources()` calls. Commit(s): pending
  - [x] Discover same-directory `AGENTS.md` and `CLAUDE.md` as visible external instruction records while load by defaulting only `AGENTS.md`; lone `CLAUDE.md` files remain enabled by default. Commit(s): pending
  - [x] Implement `@svvy/state` persistence and Settings controls for external-instruction per-file enablement, actor selection, default-off builtin global roots, custom global roots, read-status visibility, and external-editor actions. Commit(s): pending local changes
  - [x] Project external-instruction records into the Extensions pane's distinct read-only External Instructions category with source group, path, read status, content, hash, per-file enablement, actor controls, Extension Managing inspect metadata, live stale prompt-binding updates, and external-editor actions. Commit(s): pending local changes
  - [ ] Connect enabled ambient resources to runtime loading only after category-specific host/source/workspace/profile contracts exist.
- [ ] Reflect enabled ambient callable resources in actor-specific generated API declarations, enabled prompt-affecting resources in generated agent context previews and agent context fingerprints, and enabled command resources in product command routing without hidden tools or invisible prompt mutation.
  - [ ] Add resolved enabled ambient callable-resource bindings to actor-specific generated API declarations.
  - [ ] Add resolved enabled ambient prompt-resource generated previews/fingerprints and resolved ambient command-resource product routing.

## 14B. Snippets Prompt Macros

Current product decisions for this section are specified in `docs/specs/snippets.spec.md`.

- [x] Add the Snippets pane with managed `svvy` snippets, read-only discovered Markdown snippets, source badges, previews, open-external-editor actions, and managed snippet create/edit/rename/delete controls. Commit(s): pending.
  - [x] Add managed `svvy` Snippet records in `@svvy/state`, runtime discovery/expansion/invalidation for discovered Markdown snippets, and runtime/state facade-backed managed Snippet commands plus read models consumed by desktop for create, edit/rename, delete, and merged managed/discovered listing while keeping discovered Snippets read-only. Commit(s): pending.
- [x] Expose prompt composition through Agents/Extensions generated context plus separate Snippets. Commit(s): pending.
  - [x] Generated agent context is surfaced through Agents/Extensions surfaces, without a Prompt Library/Context Library pane or shell open path. Commit(s): pending.
  - [x] Internal prompt-composition state/edit contracts use generated agent-context and Snippets-native naming through the runtime facade plus state read/command facades rather than generic RPC/store surfaces. Commit(s): pending.
- [x] Add composer `@` picker Snippet results with argument fields, mention chips, explicit expand-to-text behavior, and clean prompt-text expansion before sending to pi. Commit(s): pending.
  - [x] Add `@svvy/runtime` Snippet discovery, metadata parsing, and pure placeholder expansion primitives for supported Claude and pi Markdown sources. Commit(s): pending.
  - [x] Add a structured Snippet mention model that keeps file/folder mentions as ordinary textarea `@path` text while Snippet selections render chips, edit arguments, expand to editable text, and resolve before send. Commit(s): pending.
  - [x] Extend the existing file/folder mention search to include Snippet results with separate result metadata and accept behavior. Commit(s): pending.
  - [x] Add Snippet argument keyboard progression where `Tab`, `Enter`, and final `Enter` move through inline argument fields and return focus to composer text entry. Commit(s): pending.
  - [x] Commit a full typed Snippet mention with a space into the structured Snippet mention model instead of requiring picker selection. Commit(s): pending.
- [x] Persist sent Snippet provenance in product metadata while keeping the agent-facing message as ordinary prompt text. Commit(s): pending.
  - [x] Store sent-message Snippet provenance metadata with Snippet id, source, path, content hash, arguments, and resolved content while sending only expanded prompt text. Commit(s): pending.
  - [x] Promote Snippet provenance from message text signatures into explicit durable product metadata. Commit(s): pending.
  - [x] Render sent Snippet provenance chips from durable message metadata after send-time expansion exists. Commit(s): pending.
- [x] Keep pi, Claude, Codex, plugin, MCP, and host slash-command expansion disabled so Snippets never grant tools, alter generated agent context, mount commands, or change execution policy.
  - [x] Keep pi-backed actor sessions on `noPromptTemplates`, empty prompt-template paths, and empty prompt-template overrides. Commit(s): pending.

## 16. Recovery And Test Coverage

Current product decisions for workspace-runtime restart and crash recovery are specified in `docs/specs/workspace-runtime-recovery.spec.md`.

- [x] Build a POC restart or resume flow that restores multiple open surfaces and panel bindings from durable state. Commit(s): `7f84f06`
- [x] Complete one `@svvy/runtime` workspace-runtime recovery coordinator with durable runtime recovery rows, transactional claims, leases, not-before/next-attempt timestamps, idempotency keys, per-surface queue, thread report notification, report request recovery, typed queued initial handler starts, title job recovery, Workflows generated-package refresh, separate workspace-link repair, runtime-published recovery notifications, and recovery app-log facts committed through `@svvy/state`. Commit(s): pending local changes
- [x] Restore pending request-user-input clarification and waiting state after app restart. Commit(s): `7f84f06`
- [x] Restore pending thread report notifications and per-surface prompt-lock state after app restart. Commit(s): `7f84f06`
- [x] Add integration tests that exercise the real pi-backed runtime seam for direct work. Commit(s): `b0ee858`
- [x] Expand integration coverage to pi-backed handler-thread delegation and prompt-only Smithers CLI guidance. Commit(s): `f8557d9`, `b0ee858`, `55963d9`, `097ae47`
- [x] Add integration tests that exercise restart and resume behavior across workspace state, live surface state, and panel bindings. Commit(s): `7f84f06`

## 17. Context Budget Observability

Current product decisions for this section are specified in `docs/specs/context-budget-observability.spec.md`.

- [x] Define the context-budget metric as an explicit percentage of the active model's max context for orchestrator surfaces, handler-thread surfaces, and workflow task-agent attempts. Commit(s): `8d3e362`
- [x] Define neutral, orange, and red thresholds for that metric: neutral below 40%, orange from 40% through 59%, and red from 60%, with orange marking the conservative context-degradation warning band and red marking the zone where summarization, handoff, or a fresh surface should be considered. Commit(s): `8d3e362`
- [x] Build a POC full-width focused-surface context bar below the composer for orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Render the focused-surface context bar beneath the text input for orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Build a POC compact bottom-edge context indicator for open unfocused orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Render bottom-edge context indicators on open unfocused orchestrator and handler-thread panes. Commit(s): `8d3e362`
- [x] Render context bars on focused handler-thread panes and workflow task-agent attempt summaries. Commit(s): `8d3e362`

## 18. Workflows Library Surface

Current product decisions for this section are specified in `docs/specs/workflow-library.spec.md`.

- [x] Render the Workflows pane as read-only visibility into the latest successful generated
      `@svvyx/workflows` package. Commit(s): pending local changes
- [x] Show generated `Agents`, `Components`, `Prompts`, and `Workflows` namespace exports with
      qualified export name, kind, read-only generated code, generated-file link, and source-file link.
      Commit(s): pending local changes
- [x] For `Agents.*` exports, show the generated task-agent parameter object and provide a primary
      human navigation action to the corresponding Agents pane record. Commit(s): pending local changes
- [x] Specify generated `Agents.*` task-agent parameter exports, direct parameter usage, and the
      authenticated `runTaskAgent` bridge contract that binds Smithers task-agent calls from
      handler-thread command-scoped environments to app-owned workflow-task-attempt surfaces without
      exposing broader app or workflow controls. Commit(s): pending local changes
- [x] Refresh the Workflows pane after successful `svvyx workflows build` and after Agents pane
      edits that trigger a Workflows build. Commit(s): pending local changes
- [x] Keep the Workflows pane limited to generated `@svvyx/workflows` visibility, with no inferred
      titles, inferred summaries, validation claims beyond build output, source editing, delete actions,
      or workflow-running controls. Commit(s): pending local changes

## 19. App Logs Surface

Current product decisions for this section are specified in `docs/specs/app-logs.spec.md`.

- [x] Provide workspace-scoped app log read/write surfaces backed by `@svvy/state` SQLite persistence with structured debug, info, warn, and error entries, monotonic sequence numbers, unread counts, seen state, bounded retention, and secret redaction. Commit(s): `dab04ac`.
- [x] Expose app log read, summary, mark-seen, and live-update contracts through
      bootstrap-provided state/runtime facades consumed by `@svvy/desktop` RPC handlers, backed by
      `@svvy/state` read models and `@svvy/runtime` notifications. Commit(s): `dab04ac`.
- [x] Route production product observability through one app logger without depending on Electrobun browser-tools telemetry. Commit(s): `dab04ac`.
- [x] Emit targeted app logs for app lifecycle, provider auth, RPC failures, sessions, title generation, surfaces, prompts, handler threads, Smithers CLI guidance, Workflows build validation, direct tools, `execute_typescript`, artifacts, external editor handoff, and renderer bridge issues. Commit(s): `dab04ac`.
- [x] Add a `Logs` sidebar button directly above the workflow library entry with compact action-worthy unread badges for warning and error app logs, without surfacing info-only unread logs as sidebar badges. Commit(s): `dab04ac`.
- [x] Render a dense app logs pane with level filters, grouped source filtering, search, viewport-based read marking during unfiltered browsing, expandable details, stack traces, and links to related sessions, threads, commands, and artifacts where available. Commit(s): `dab04ac`.
- [x] Render the app logs row list with TanStack Virtual, preserving variable-height expanded rows, stable row identity, persisted scroll position during live updates, older-page loading, and the explicit `New logs` affordance across filtering, search, expansion, and live updates. Commit(s): `ed7e6ea88e`.
- [x] Add representative mounted/integration coverage for the app logs pane, sidebar badges, and live-update read model. Commit(s): pending local changes
