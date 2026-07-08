import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { TestClock } from "effect/testing";
import { RuntimeContractError, StateContractError, type AbsolutePath } from "@svvy/core";
import type {
  RecordRuntimeSourceScanInput,
  StateInvalidationDescriptor,
  StateMutationResult,
  SourceInvalidationHint,
  WorkspaceId,
} from "@svvy/core";
import {
  RuntimeSourceInvalidationCoordinator,
  layerRuntimeSourceInvalidationCoordinator,
  type SourceInvalidationEvent,
  type SourceInvalidationHost,
  type SourceWatchInput,
} from "./source-invalidation-coordinator";

describe("runtime source invalidation coordinator", () => {
  it.effect("runs deterministic reconcile without notifying the watcher callback", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-reconcile");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          const event = yield* coordinator.reconcile({
            domains: ["workflows"],
            reason: "manual",
          });
          const duplicate = yield* coordinator.reconcile({
            domains: ["workflows"],
            reason: "manual",
          });

          assert.deepStrictEqual(event?.domains, ["workflows"]);
          assert.strictEqual(event?.reason, "manual");
          assert.deepStrictEqual(event?.afterCommit, []);
          assert.strictEqual(duplicate, null);
          assert.deepStrictEqual(events, []);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("records extension child source-root fingerprints with scan receipts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-root-fingerprints");
        const sourcesUser = join(root, "extensions", "sources", "user");
        const webSource = join(sourcesUser, "web");
        const notesSource = join(sourcesUser, "notes");
        const recordedScans: RecordRuntimeSourceScanInput[] = [];

        yield* Effect.sync(() => {
          mkdirSync(webSource, { recursive: true });
          mkdirSync(notesSource, { recursive: true });
          writeFileSync(join(webSource, "manifest.json"), '{"id":"web"}\n');
          writeFileSync(join(webSource, "index.ts"), "export default {}\n");
          writeFileSync(join(notesSource, "manifest.json"), '{"id":"notes"}\n');
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;
          yield* Effect.sync(() => {
            writeFileSync(join(webSource, "index.ts"), "export default { updated: true }\n");
          });
          yield* coordinator.reconcile({ domains: ["extensions"], reason: "manual" });
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "extensions",
                  fingerprintChildDirectories: true,
                  kind: "directory",
                  path: sourcesUser,
                  recursive: true,
                },
              ]),
              sourceScanRecorder: {
                scope: { kind: "app-global" },
                statePort: {
                  recordSourceScan: (input) =>
                    Effect.sync(() => {
                      recordedScans.push(input);
                      return stateMutation({
                        scope: input.scope,
                        scopeKey: "app-global",
                        domain: input.domain,
                        sourceFingerprint: input.sourceFingerprint,
                        diagnostics: input.diagnostics,
                        lastObservedPath: null,
                        lastObservationKind: "scan",
                        observedAt: input.scannedAt,
                        createdAt: input.scannedAt,
                        updatedAt: input.scannedAt,
                      });
                    }),
                },
              },
              onDomainsChanged: () => Effect.void,
            }),
          ),
        );

        const lastScan = recordedScans.at(-1);
        assert.strictEqual(lastScan?.domain, "extensions");
        assert.deepStrictEqual(
          lastScan?.sourceRoots?.map((sourceRoot) => sourceRoot.sourceRoot),
          [notesSource, webSource],
        );
        assert.strictEqual(
          lastScan?.sourceRoots?.find((sourceRoot) => sourceRoot.sourceRoot === webSource)
            ?.rootFingerprint,
          sourceBuildFingerprint(webSource),
        );
      }),
    ),
  );

  it.effect("keeps unrequested domain fingerprints pending during filtered reconcile", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-domain-filter");
        const workflows = join(root, "workflows", "agents");
        const extensions = join(root, "extensions", "sources", "user");
        const events: SourceInvalidationEvent[] = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          mkdirSync(extensions, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
          writeFileSync(join(extensions, "web.md"), "old\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["extensions", "workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
            writeFileSync(join(extensions, "web.md"), "new\n");
          });
          const workflowsEvent = yield* coordinator.reconcile({
            domains: ["workflows"],
            reason: "manual",
          });
          const extensionsEvent = yield* coordinator.reconcile({
            domains: ["extensions"],
            reason: "manual",
          });
          const duplicate = yield* coordinator.reconcile({
            domains: ["extensions", "workflows"],
            reason: "manual",
          });

          assert.deepStrictEqual(workflowsEvent?.domains, ["workflows"]);
          assert.deepStrictEqual(extensionsEvent?.domains, ["extensions"]);
          assert.strictEqual(duplicate, null);
          assert.deepStrictEqual(events, []);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
                {
                  domain: "extensions",
                  kind: "directory",
                  path: extensions,
                  recursive: true,
                },
              ]),
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("keeps changed fingerprints pending when notification fails", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-notification-retry");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        let failNextNotification = false;

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
            failNextNotification = true;
          });

          yield* coordinator.requestScan("first");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;
          assert.deepStrictEqual(events, []);

          yield* coordinator.requestScan("retry");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "retry" }],
          );

          events.length = 0;
          yield* coordinator.requestScan("duplicate");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;
          assert.deepStrictEqual(events, []);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  if (failNextNotification) {
                    failNextNotification = false;
                    throw new Error("notification failed");
                  }
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("retries failed source scan commits before publishing the domain event", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-scan-retry");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const recordedScans: RecordRuntimeSourceScanInput[] = [];
        const workspaceId = "workspace_source_retry_test" as WorkspaceId;
        let remainingFailures = 0;

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;
          recordedScans.length = 0;
          remainingFailures = 2;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          yield* coordinator.requestScan("retry");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(events, []);
          assert.strictEqual(recordedScans.length, 1);

          yield* TestClock.adjust(10);
          yield* Effect.yieldNow;
          assert.deepStrictEqual(events, []);
          assert.strictEqual(recordedScans.length, 2);

          yield* TestClock.adjust(20);
          yield* Effect.yieldNow;

          assert.strictEqual(recordedScans.length, 3);
          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "retry" }],
          );
          assert.deepStrictEqual(events[0]?.afterCommit, [
            { scope: "workspace", workspaceId, invalidation: { model: "snippets" } },
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              retryInitialDelayMs: 10,
              retryMaxAttempts: 2,
              retryMaxDelayMs: 20,
              sourceScanRecorder: {
                scope: { kind: "workspace", workspaceId },
                statePort: {
                  recordSourceScan: (input) =>
                    Effect.gen(function* () {
                      recordedScans.push(input);
                      if (remainingFailures > 0) {
                        remainingFailures -= 1;
                        return yield* Effect.fail(
                          new StateContractError({
                            operation: "runtimeSourceState.recordSourceScan",
                            reason: "transaction-failed",
                            message: "source scan retry test failure",
                          }),
                        );
                      }
                      return stateMutation(
                        {
                          scope: input.scope,
                          scopeKey: `workspace:${workspaceId}`,
                          domain: input.domain,
                          sourceFingerprint: input.sourceFingerprint,
                          diagnostics: input.diagnostics,
                          lastObservedPath: null,
                          lastObservationKind: "scan",
                          observedAt: input.scannedAt,
                          createdAt: input.scannedAt,
                          updatedAt: input.scannedAt,
                        },
                        [
                          {
                            scope: "workspace",
                            workspaceId,
                            invalidation: { model: "snippets" },
                          },
                        ],
                      );
                    }),
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("does not retry non-retryable source scan commit failures", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-scan-non-retryable");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const recordedScans: RecordRuntimeSourceScanInput[] = [];
        const errors: Array<{ label: string; error: unknown }> = [];
        const workspaceId = "workspace_source_non_retryable_test" as WorkspaceId;
        let failSourceScans = false;

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;
          recordedScans.length = 0;
          errors.length = 0;
          failSourceScans = true;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          yield* coordinator.reconcile({ domains: ["workflows"], reason: "non-retryable" });
          yield* Effect.yieldNow;

          assert.deepStrictEqual(events, []);
          assert.strictEqual(recordedScans.length, 1);
          assert.strictEqual(errors.length, 1);

          yield* TestClock.adjust(100);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(events, []);
          assert.strictEqual(recordedScans.length, 1);
          assert.strictEqual(errors.length, 1);
          assert.strictEqual(errors[0]?.label, "source-scan:workflows");
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              retryInitialDelayMs: 10,
              retryMaxAttempts: 2,
              retryMaxDelayMs: 20,
              sourceScanRecorder: {
                scope: { kind: "workspace", workspaceId },
                statePort: {
                  recordSourceScan: (input) =>
                    Effect.gen(function* () {
                      recordedScans.push(input);
                      if (!failSourceScans) {
                        return stateMutation(
                          {
                            scope: input.scope,
                            scopeKey: `workspace:${workspaceId}`,
                            domain: input.domain,
                            sourceFingerprint: input.sourceFingerprint,
                            diagnostics: input.diagnostics,
                            lastObservedPath: null,
                            lastObservationKind: "scan",
                            observedAt: input.scannedAt,
                            createdAt: input.scannedAt,
                            updatedAt: input.scannedAt,
                          },
                          [
                            {
                              scope: "workspace",
                              workspaceId,
                              invalidation: { model: "snippets" },
                            },
                          ],
                        );
                      }
                      return yield* Effect.fail(
                        new StateContractError({
                          operation: "runtimeSourceState.recordSourceScan",
                          reason: "invalid-input",
                          message: "source scan input is invalid",
                        }),
                      );
                    }),
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              onWatchError: (error, label) => {
                errors.push({ error, label });
              },
            }),
          ),
        );
      }),
    ),
  );

  it.effect("keeps scan fingerprints pending when source scan commits exhaust retries", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-scan-terminal-failure");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const recordedScans: RecordRuntimeSourceScanInput[] = [];
        const errors: Array<{ label: string; error: unknown }> = [];
        const workspaceId = "workspace_source_terminal_failure_test" as WorkspaceId;
        let failSourceScans = false;

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;
          recordedScans.length = 0;
          errors.length = 0;
          failSourceScans = true;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          yield* coordinator.requestScan("first");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(events, []);
          assert.deepStrictEqual(
            errors.map((entry) => entry.label),
            ["source-scan:workflows"],
          );
          assert.strictEqual(recordedScans.length, 1);

          yield* coordinator.requestScan("retry");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(events, []);
          assert.deepStrictEqual(
            errors.map((entry) => entry.label),
            ["source-scan:workflows", "source-scan:workflows"],
          );
          assert.strictEqual(recordedScans.length, 2);
          assert.strictEqual(
            recordedScans[1]?.sourceFingerprint,
            recordedScans[0]?.sourceFingerprint,
          );
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              retryInitialDelayMs: 1,
              retryMaxAttempts: 0,
              sourceScanRecorder: {
                scope: { kind: "workspace", workspaceId },
                statePort: {
                  recordSourceScan: (input) =>
                    Effect.gen(function* () {
                      recordedScans.push(input);
                      if (failSourceScans) {
                        return yield* Effect.fail(
                          new StateContractError({
                            operation: "runtimeSourceState.recordSourceScan",
                            reason: "transaction-failed",
                            message: "terminal source scan failure",
                          }),
                        );
                      }
                      return stateMutation(
                        {
                          scope: input.scope,
                          scopeKey: `workspace:${workspaceId}`,
                          domain: input.domain,
                          sourceFingerprint: input.sourceFingerprint,
                          diagnostics: input.diagnostics,
                          lastObservedPath: null,
                          lastObservationKind: "scan",
                          observedAt: input.scannedAt,
                          createdAt: input.scannedAt,
                          updatedAt: input.scannedAt,
                        },
                        [
                          {
                            scope: "workspace",
                            workspaceId,
                            invalidation: { model: "snippets" },
                          },
                        ],
                      );
                    }),
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              onWatchError: (error, label) =>
                errors.push({
                  label,
                  error,
                }),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("resolves watcher filenames against the watched root before scheduling scans", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-watch-relative");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const watchListeners: Array<{
          root: string;
          listener: (eventType: string, filename: string | Buffer | null) => Effect.Effect<void>;
        }> = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          assert.deepStrictEqual(
            watchListeners.map((watch) => watch.root),
            [workflows],
          );
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          const watch = watchListeners[0];
          assert.ok(watch);
          yield* watch.listener("change", "implementer.agent.json");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "filesystem_event" }],
          );
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              host: {
                ...testHost(root),
                watch: (watchedRoot, listener) => {
                  watchListeners.push({ root: watchedRoot, listener });
                  return { close: () => undefined };
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              watchEnabled: true,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("maps ignored in-root watcher paths to parent-domain scans", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-watch-ignored");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const watchListeners: Array<{
          root: string;
          listener: (eventType: string, filename: string | Buffer | null) => Effect.Effect<void>;
        }> = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          const watch = watchListeners[0];
          assert.ok(watch);
          yield* watch.listener("rename", "implementer.agent.json.tmp");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "ignored-path-parent-domain-scan" }],
          );
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              host: {
                ...testHost(root),
                watch: (watchedRoot, listener) => {
                  watchListeners.push({ root: watchedRoot, listener });
                  return { close: () => undefined };
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              watchEnabled: true,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("ignores watcher filenames outside configured source roots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-watch-outside");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const watchListeners: Array<{
          root: string;
          listener: (eventType: string, filename: string | Buffer | null) => Effect.Effect<void>;
        }> = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          const watch = watchListeners[0];
          assert.ok(watch);
          yield* watch.listener("change", "../outside.agent.json");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(events, []);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              host: {
                ...testHost(root),
                watch: (watchedRoot, listener) => {
                  watchListeners.push({ root: watchedRoot, listener });
                  return { close: () => undefined };
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
              watchEnabled: true,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("classifies public hints inside configured source roots as scans", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-hint-scan");
        const extensions = join(root, "extensions", "sources", "user");

        yield* Effect.sync(() => {
          mkdirSync(extensions, { recursive: true });
          writeFileSync(join(extensions, "web.md"), "instructions\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;
          const classification = yield* coordinator.classifyHint({
            scope: { kind: "app-global" },
            domain: "extensions",
            path: join(extensions, "web.md") as AbsolutePath,
          } satisfies SourceInvalidationHint);

          assert.strictEqual(classification, "scan");
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "extensions",
                  kind: "directory",
                  path: extensions,
                  recursive: true,
                },
              ]),
              onDomainsChanged: () => Effect.void,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("classifies in-root generated and temporary hint paths as parent-domain scans", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-hint-ignore");
        const extensions = join(root, "extensions", "sources", "user");

        yield* Effect.sync(() => {
          mkdirSync(extensions, { recursive: true });
          writeFileSync(join(extensions, "web.md"), "instructions\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;
          const generated = yield* coordinator.classifyHint({
            scope: { kind: "app-global" },
            domain: "extensions",
            path: join(extensions, ".svvy", "generated", "index.ts") as AbsolutePath,
          } satisfies SourceInvalidationHint);
          const temporary = yield* coordinator.classifyHint({
            scope: { kind: "app-global" },
            domain: "extensions",
            path: join(extensions, "web.md.tmp") as AbsolutePath,
          } satisfies SourceInvalidationHint);

          assert.strictEqual(generated, "scan-parent-domain");
          assert.strictEqual(temporary, "scan-parent-domain");
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "extensions",
                  kind: "directory",
                  path: extensions,
                  recursive: true,
                },
              ]),
              onDomainsChanged: () => Effect.void,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("rejects public hint paths outside configured source roots", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-hint-outside");
        const extensions = join(root, "extensions", "sources", "user");

        yield* Effect.sync(() => {
          mkdirSync(extensions, { recursive: true });
          writeFileSync(join(extensions, "web.md"), "instructions\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;
          const exit = yield* coordinator
            .classifyHint({
              scope: { kind: "app-global" },
              domain: "extensions",
              path: join(root, "outside", "web.md.tmp") as AbsolutePath,
            } satisfies SourceInvalidationHint)
            .pipe(Effect.exit);

          assert.isTrue(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
            assert.instanceOf(failure, RuntimeContractError);
            assert.strictEqual(failure.reason, "invalid-input");
          }
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "extensions",
                  kind: "directory",
                  path: extensions,
                  recursive: true,
                },
              ]),
              onDomainsChanged: () => Effect.void,
            }),
          ),
        );
      }),
    ),
  );

  it.effect("forces one scan at max coalescing latency during continuous hints", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-max-coalescing");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          events.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          yield* coordinator.requestScan("first");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(9);
          yield* coordinator.requestScan("second");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(9);
          yield* coordinator.requestScan("third");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(7);
          yield* Effect.yieldNow;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "third" }],
          );

          events.length = 0;
          yield* TestClock.adjust(20);
          yield* Effect.yieldNow;
          assert.deepStrictEqual(events, []);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              debounceMs: 10,
              maxCoalescingLatencyMs: 25,
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );

  it.effect("exposes source invalidation through a scoped Effect layer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* tempRoot("runtime-source-invalidation");
        const workflows = join(root, "workflows", "agents");
        const events: SourceInvalidationEvent[] = [];
        const recordedScans: RecordRuntimeSourceScanInput[] = [];
        const workspaceId = "workspace_source_invalidation_test" as WorkspaceId;

        yield* Effect.sync(() => {
          mkdirSync(workflows, { recursive: true });
          writeFileSync(join(workflows, "implementer.agent.json"), "{}\n");
        });

        yield* Effect.gen(function* () {
          const coordinator = yield* RuntimeSourceInvalidationCoordinator;

          assert.deepStrictEqual(
            events.map((event) => ({ domains: event.domains, reason: event.reason })),
            [{ domains: ["workflows"], reason: "startup_reconcile" }],
          );
          assert.deepStrictEqual(
            recordedScans.map((scan) => scan.domain),
            ["workflows"],
          );
          events.length = 0;
          recordedScans.length = 0;

          yield* Effect.sync(() => {
            writeFileSync(join(workflows, "implementer.agent.json"), '{"id":"implementer"}\n');
          });
          yield* coordinator.requestScan("test");
          yield* Effect.yieldNow;
          yield* TestClock.adjust(1);
          yield* Effect.yieldNow;

          assert.strictEqual(events.length, 1);
          const event = events[0];
          assert.ok(event);
          assert.deepStrictEqual(event.domains, ["workflows"]);
          assert.deepStrictEqual(
            recordedScans.map((scan) => ({
              domain: scan.domain,
              scope: scan.scope,
              sourceFingerprint: scan.sourceFingerprint,
            })),
            [
              {
                domain: "workflows",
                scope: { kind: "workspace", workspaceId },
                sourceFingerprint: event.sourceFingerprints.workflows,
              },
            ],
          );
          assert.deepStrictEqual(event.afterCommit, [
            { scope: "workspace", workspaceId, invalidation: { model: "snippets" } },
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceInvalidationCoordinator({
              ...testCoordinatorOptions(root, [
                {
                  domain: "workflows",
                  kind: "directory",
                  path: workflows,
                  recursive: true,
                },
              ]),
              sourceScanRecorder: {
                scope: { kind: "workspace", workspaceId },
                statePort: {
                  recordSourceScan: (input) =>
                    Effect.sync(() => {
                      recordedScans.push(input);
                      return stateMutation(
                        {
                          scope: input.scope,
                          scopeKey: `workspace:${workspaceId}`,
                          domain: input.domain,
                          sourceFingerprint: input.sourceFingerprint,
                          diagnostics: input.diagnostics,
                          lastObservedPath: null,
                          lastObservationKind: "scan",
                          observedAt: input.scannedAt,
                          createdAt: input.scannedAt,
                          updatedAt: input.scannedAt,
                        },
                        [
                          {
                            scope: "workspace",
                            workspaceId,
                            invalidation: { model: "snippets" },
                          },
                        ],
                      );
                    }),
                },
              },
              onDomainsChanged: (event) =>
                Effect.sync(() => {
                  events.push(event);
                }),
            }),
          ),
        );
      }),
    ),
  );
});

function tempRoot(name: string) {
  return Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), `svvy-${name}-`))),
    (root) =>
      Effect.sync(() => {
        rmSync(root, { recursive: true, force: true });
      }),
  );
}

function stateMutation<T>(
  value: T,
  afterCommit: readonly StateInvalidationDescriptor[] = [],
): StateMutationResult<T> {
  return { value, afterCommit };
}

function testCoordinatorOptions(homeDir: string, inputs: readonly SourceWatchInput[]) {
  return {
    debounceMs: 1,
    host: testHost(homeDir),
    readInputs: () => inputs,
    reconciliationIntervalMs: 0,
    watchEnabled: false,
  };
}

function testHost(homeDir: string): SourceInvalidationHost {
  return {
    homeDir,
    path: {
      dirname,
      join,
      resolve,
    },
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => {
        try {
          return statSync(path).isDirectory();
        } catch {
          return false;
        }
      },
      isFile: (path) => {
        try {
          return statSync(path).isFile();
        } catch {
          return false;
        }
      },
      readDirectory: (path) =>
        readdirSync(path, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          kind: entry.isDirectory()
            ? ("directory" as const)
            : entry.isFile()
              ? ("file" as const)
              : ("other" as const),
        })),
      readFileString: (path) => readFileSync(path, "utf8"),
      realPath: (path) => resolve(path),
    },
    hashStrings: (parts) => {
      const hash = createHash("sha256");
      for (const part of parts) {
        hash.update(part);
        hash.update("\0");
      }
      return hash.digest("hex");
    },
    watch: () => ({ close: () => undefined }),
  };
}

function sourceBuildFingerprint(sourceRoot: string): string {
  const files = listBuildInputFiles(sourceRoot);
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.slice(sourceRoot.length + 1));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function listBuildInputFiles(root: string): string[] {
  const files: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === ".svvy") {
        continue;
      }
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (entry.isFile()) {
        files.push(path);
      }
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}
