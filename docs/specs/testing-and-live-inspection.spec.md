# Testing And Live Inspection Specification

## Status

- Date: 2026-07-13
- Status: active
- Scope: repository testing infrastructure and agent-operated verification

## Objective

`svvy` must be unusually easy for a coding agent to test as a real desktop product. A single agent
must be able to launch an isolated production-reachable dev app, drive it semantically, inspect
product and process evidence, reproduce a failing automated journey interactively, make a targeted
fix, and verify that fix without assembling a new harness for each feature.

Exhaustive testing and convenient live inspection are one system. Automated journeys produce the
same identities and evidence that the live inspection lane exposes, and the live lane exercises the
same dev-channel product build rather than a fixture renderer or alternate app implementation.

## Supported Lanes

### Live Inspection

`bun run inspect:app -- --workspace <absolute-path>` is the canonical interactive inspection lane.
It:

- launches the real dev-channel Electrobun app through the existing `bun run dev` path
- uses an isolated temporary `HOME` by default, with explicit `--home` and `--keep-home` controls
- supports `--stub-provider` for a deterministic credential-free streamed prompt and concurrent
  first-turn title-generation lifecycle
- prints the resolved browser-tools `appId` and `bridgeUrl` plus ready-to-run diagnostics and an
  exact semantic create/fill/send/wait/screenshot smoke sequence
- streams host and renderer process output without swallowing failures
- stops the complete dev process tree and removes the temporary `HOME` when its terminal receives
  `Ctrl+C`
- provisions missing pinned Electrobun CLI/core release assets through the Node launcher with bounded
  redirects and timeouts, visible byte completion, staged validation, and atomic installation before
  the older native CLI runtime can enter its unbounded downloader
- owns the complete dev descendant process group, forwards termination once, escalates boundedly only
  when the group does not exit, aborts retained output readers, and cleans up only the temporary home
  it owns

The default control surface is `electrobun-browser-tools`: semantic role/test-id/CSS locators,
DOM/layout inspection, page input, product state, events, logs, errors, network facts, performance
facts, and screenshots where supported. CuaDriver is a companion for real native interaction,
physical drag/scroll/context-menu behavior, system dialogs, accessibility inspection, and macOS
visual capture when it is available to the active agent environment. Lack of CuaDriver must be
reported explicitly; it must not be silently approximated with test-only DOM behavior.

When Codex seatbelt restrictions prevent either OrbStack's host socket or CuaDriver's native-window
probe from being reached, the launcher reports the boundary as `sandbox-restricted` and prints the
exact read-only host probe to run with approval. A sandbox false negative must never be presented as
an unhealthy host installation or trigger an automatic reset, reinstall, permission change, or
daemon restart.

The app mounts browser tools only after the real desktop bootstrap has started and the main window
exists, then publishes its bridge metadata and a buffered `app.ready` event as the single launch
barrier. It exposes
independent `ready`, `unavailable`, or typed `error` namespaces for settings, agents, extensions,
app/workspace logs, prompt history, request input, approvals, snippets, generated Workflows,
workspace chrome/layout, and external instructions. Committed app/workspace read-model
invalidations are forwarded as buffered bridge events with model and identity payloads, so live and
automated checks can wait on the authoritative mutation barrier and then read exact state instead
of polling DOM text. System prompts, raw auth, secret values, and command payloads stay outside this
inspection boundary.

The bridge remains dev-channel-only. A stable-only failure must first be reproduced without changing
product behavior, then narrowed in the inspectable dev build. Stable packaging must never ship the
inspection bridge.

### Automated Desktop E2E

`bun run test:e2e` is the only automated desktop e2e lane. It runs the real dev-channel app inside
the dedicated native ARM64 OrbStack Linux/Xvfb machine. The Linux product and test build bundle the
same Electrobun CEF renderer; the shared harness requires the CEF runtime artifacts and confirms
`libcef.so` is mapped by the live app process before a journey proceeds. It never silently falls
back to the unstable WebKitGTK native-bridge path. Linux CEF views without an explicit partition
use the renderer's ephemeral request context instead of Electrobun's structurally invalid nested
persistent-default profile, and any profile-initialization error is a startup-contract failure.
Focused files are forwarded after `--`:

```bash
bun run test:e2e -- e2e/svvy-smoke.test.ts
```

`bun run setup:e2e` explicitly pre-provisions the lane, but ordinary test runs are self-healing:
they compare an exact manifest of machine image, ARM64 architecture, Bun version, and declared apt
packages, run official setup only when that manifest or the installed state drifts, and reject an
existing machine of the wrong architecture without deleting or replacing it. AMD64 is an opt-in
diagnostic lane and must use a distinct machine identity:

```bash
ELECTROBUN_E2E_ORB_ARCH=amd64 ELECTROBUN_E2E_ORB_MACHINE=svvy-e2e-amd64 bun run test:e2e -- e2e/svvy-smoke.test.ts
```

AMD64 emulation on Apple Silicon is not the canonical acceptance lane. Native AMD64 release
coverage belongs on native AMD64 Linux infrastructure.

The app runtime currently selects Bun's official rolling `canary` release with a minimum runtime
version of 1.4.0. Stable Bun 1.3.14 predates upstream fix
`9e6a19ba2e3c43f0782c9c9fa24a608f9824bb06`: a threadsafe FFI callback could copy JSC strong
handles on a native calling thread, corrupting the app Worker's JSC state during Electrobun
startup. Electrobun's downloader maps the explicit `canary` contract to Bun's official `canary`
release tag, while the E2E setup and embedded-runner gates require an official canary revision and
the minimum version. The observed revision is receipted in every run. This rolling pin is the
current product-runtime contract until an official stable Bun release contains that fix; project
tooling may remain on the stable package-manager version because it does not host Electrobun's
native callback runtime.

The lane uses isolated homes and deterministic local provider stubs where model behavior is needed.
When one provided home is reused across launches, the harness snapshots only durable `.config`,
`.local`, and `.state` directories and only regular files/directories within them. It recreates
disposable `.cache` and `.tmp` roots for each launch attempt instead of replaying CEF, D-Bus, Xvfb,
or other native IPC residue. This makes restart/persistence journeys deterministic without copying
sockets, FIFOs, symlinks, or transient renderer profiles.
A lifecycle acceptance test must create behavior through the public UI/runtime boundary it claims
to cover. Directly seeded pi transcripts, SQLite rows, app logs, command facts, or layout JSON are
allowed only for explicitly projection-focused tests and do not count as live lifecycle coverage.

The OrbStack runner writes a build-completion stamp after synchronizing and building the current
inputs. The shared app harness adopts that stamped build once, records a content fingerprint over
the configured build inputs, and validates both the fingerprint and required artifacts before every
launching test process. An unchanged focused run reuses the verified bundle; changed content,
including dependency patches and content whose mtime was preserved, forces one clean rebuild; missing outputs and
incomplete builds fail before app launch. A focused test must therefore never exercise stale source,
and the runner and harness must not rebuild the same synchronized inputs twice. Run evidence and
active-launch paths are absolute and remain outside fingerprinted source inputs, while any legitimate
test-process fallback build uses the same production environment as the runner build.

All `e2e/**/*.ts` sources are part of the normal root TypeScript project and therefore the
`bun run check` typecheck. Tests use the exact `electrobun-browser-tools` locator contract; they do
not pass silently ignored Playwright-only options. Exact accessible names and text are expressed
with anchored regular expressions when the bridge API has no explicit exact-match option.

Each app launch receives its own D-Bus/Xvfb session, and each test file runs in a fresh Bun test
process. Cleanup first requests app-owned graceful quit through the trusted bridge, proves the
tracked launcher/app/CEF process tree exited, and reserves TERM/KILL cleanup for a failed or
interrupted run. The runner performs run-id-scoped cleanup rather than broad process matching.
The pinned Electrobun 1.18.1 Linux CEF native shutdown path queues browser destruction after
stopping the event loop and can call `CefShutdown()` while browsers are still live. The dependency
patch therefore exits the Linux process only after svvy's asynchronous before-quit lifecycle has
flushed and disposed app-owned resources, without entering that unsafe native CEF shutdown path.
macOS and Windows retain Electrobun's native shutdown sequence.

`bun run test:e2e:startup-soak` repeatedly exercises the complete start, renderer-ready bridge,
workspace-shell, and graceful-shutdown lifecycle with launch retries disabled. A larger diagnostic
soak can be requested explicitly, for example:

```bash
SVVY_E2E_STARTUP_SOAK_LAUNCHES=50 bun run test:e2e -- e2e/svvy-smoke.test.ts
```

Startup-soak evidence is distinct from exhaustive shipped-feature coverage: both must pass for a
complete desktop acceptance result.

Automated tests must not add retries, broad sleeps, force-click defaults, selector churn,
best-effort fallbacks, test-only product behavior, a visible local e2e default, or a Docker e2e
alternative. A failing production-reachable path is reproduced through the live inspection lane and
fixed at the product or contract boundary. Tests change only when that inspection proves the
assertion is obsolete.

### Unit, Effect, And Boundary Lanes

Unit, Effect, schema, and package-boundary tests remain the exhaustive fast evidence for pure and
package-level contracts. They do not substitute for desktop lifecycle journeys where renderer,
runtime, persistence, process, sandbox, or app-bootstrap composition is part of the behavior.

## Durable E2E Evidence

Every `bun run test:e2e` invocation has one `SVVY_E2E_RUN_ID`. Host-visible evidence lives under:

```text
e2e-results/<runId>/
  run.json
  runner.stdout.log
  runner.stderr.log
  failures/<failureId>/...
  startup-failures/<failureId>/...
  native-crashes/<coreId>.gdb.txt
  native-crashes/<coreId>.resolver.txt
  native-crashes/<coreId>.executable.txt
```

The run wrapper retains complete runner stdout/stderr, writes duration and exit facts, and records
host platform/architecture, requested and observed guest architecture, machine image, runner and
embedded Bun versions and revisions, Electrobun version, configured Linux renderer, and packaged launcher/Bun/
native-wrapper/CEF binary identities. It syncs
failure evidence from the OrbStack workspace back into the host checkout even when the test command
fails.

Before a failed test closes its app, the shared harness captures as much of this evidence as the
mounted bridge supports:

- original error name, message, stack, and cause summary
- app id, bridge URL, workspace, test home, run id, and timestamps
- process stdout and stderr
- doctor, status, tree, page URL, DOM snapshot, visible body text, and body HTML
- every exposed state namespace and its current value
- recent events, logs, errors, network facts, and performance facts
- an immediate headless-display screenshot captured independently before bridge probes can block,
  an additional browser screenshot when the renderer still responds, or explicit capture errors
- non-secret SQLite, SQLite sidecar, pi-session, and app-log files needed for postmortem inspection

Native core staging preserves the original executable directory. The runner resolves and validates
the exact crashed executable and command against the core before collecting signal information,
registers, fault-site instructions, all-thread GDB output, and shared-library state; a mismatched
or unresolved core remains intact with resolver evidence instead of being deleted after an unusable
trace. Core discovery runs after every test invocation, including otherwise passing journeys; any
native core fails the run so process disappearance cannot conceal a shutdown crash.

Failure capture is best-effort per evidence item but never best-effort overall: its manifest records
every successful and failed capture, and the harness rethrows the original test failure. Evidence
collection must never copy auth files, environment files, key material, secret-store content, or
other credentials.

## Coverage Inventory And Gates

`e2e/feature-coverage.ts` maps every `docs/features.ts` id to exactly one current desktop e2e level:

- `live`: behavior is created through the real UI/runtime lifecycle
- `projection`: the real app renders or consumes seeded state, but the claimed lifecycle is not run
- `missing`: no desktop e2e evidence exists

`bun run check:e2e-coverage` is the structural inventory gate. It rejects new or renamed features
without an explicit e2e decision, duplicate entries, unknown feature ids, and missing test files.
`bun run check:e2e-coverage:complete` is the strict shipped-feature gate used by `bun run check`; it
includes the structural checks and fails while any shipped feature lacks `live` coverage.

The inventory is evidence, not a waiver. `projection` and `missing` rows carry the concrete journey
still required, and are promoted only after that real journey passes.

## Required Lifecycle Journey Families

Exhaustive desktop coverage includes, at minimum:

1. startup, default workspace, workspace tabs, layouts, shutdown, and restart
2. provider auth readiness plus a deterministic prompt and streamed assistant response
3. exact system prompt, external instructions, generated context refresh, and prompt history
4. real Shell, Apply Patch, and Execute TypeScript calls through approval, sandbox, command facts,
   artifacts, live projection, cancellation, failure, and reload
5. orchestrator delegation, handler interaction, reports, follow-ups, durable episodes, and direct
   user messaging
6. active-turn queueing, reorder, restore, Steer, request-input answer delivery, and recovery
7. blocking request input and user approval waits, timeouts, cancellation, and restart restoration
8. Agents, Extensions, source invalidation, build readiness, generated context, and conflict handling
9. Workflows source operations, generated package visibility/linking, Smithers CLI execution, and
   the runtime-owned task-agent bridge
10. artifacts, command inspector, app logs, correlated errors, and retained oversized output
11. accessibility, keyboard-only operation, narrow layouts, native interactions, visual states, and
    stable live updates without layout shift
12. crash/restart recovery during each durable in-flight work family

## Completion Criteria

This testing system is complete only when:

- the live inspection command can be used from a fresh checkout without custom scripting
- every automated failure leaves a usable host-side forensic bundle
- every shipped feature is `live` in the feature coverage inventory
- each required journey family includes success, failure, cancellation/wait where applicable,
  persistence/reload, and correlated observability assertions
- the zero-retry startup soak proves repeated renderer-ready launch and app-owned process-tree
  shutdown independently of feature-journey coverage
- the complete coverage gate, focused/full OrbStack e2e lanes, `bun run check`, and representative
  local macOS live/visual inspection all pass
- no passing test depends on retries, force-click defaults, test-only product behavior, or stale
  seeded state standing in for the lifecycle being claimed
