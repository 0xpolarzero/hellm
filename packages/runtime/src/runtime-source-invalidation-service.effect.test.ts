import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  RuntimeEventStreamError,
  type AbsolutePath,
  type GeneratedPackageName,
  type GeneratedPackagesRefreshResult,
  type InternalRefreshGeneratedPackagesRequest,
  type RefreshGeneratedContextRequest,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type StateInvalidationDescriptor,
  type WorkspaceId,
} from "@svvy/core";
import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { RuntimeGeneratedPackageRefreshService } from "./runtime-generated-package-refresh-service";
import {
  RuntimeSourceInvalidationScanPort,
  RuntimeSourceInvalidationService,
  layerRuntimeSourceInvalidationService,
} from "./runtime-source-invalidation-service";
import type { SourceInvalidationEvent } from "./source-invalidation-coordinator";

const workspaceOne = "workspace_runtime_source_service_01" as WorkspaceId;
const workspaceTwo = "workspace_runtime_source_service_02" as WorkspaceId;

const extensionHint = {
  scope: { kind: "app-global" },
  domain: "extensions",
  path: "/tmp/svvy/extensions/sources/user/web/index.ts" as AbsolutePath,
  observedAt: "2026-06-19T08:00:00.000Z" as NonNullable<SourceInvalidationHint["observedAt"]>,
} satisfies SourceInvalidationHint;

describe("runtime source invalidation service", () => {
  it.effect("classifies public hints before scheduling source scans", () => {
    const scheduledScans: SourceReconcileRequest[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      yield* service.hint(extensionHint);

      assert.deepStrictEqual(scheduledScans, [
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "watcher-debounce",
        },
      ]);
    }).pipe(Effect.provide(testLayer({ scheduledScans })));
  });

  it.effect("schedules parent source domains for in-root generated or temporary hint paths", () => {
    const scheduledScans: SourceReconcileRequest[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      yield* service.hint(extensionHint);

      assert.deepStrictEqual(scheduledScans, [
        {
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "ignored-path-parent-domain-scan",
        },
      ]);
    }).pipe(Effect.provide(testLayer({ classification: "scan-parent-domain", scheduledScans })));
  });

  it.effect("fails public hints classified outside allowed roots as typed runtime errors", () =>
    Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const exit = yield* service.hint(extensionHint).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
        assert.instanceOf(failure, RuntimeContractError);
        assert.strictEqual(failure.reason, "invalid-input");
      }
    }).pipe(Effect.provide(testLayer({ classification: "fail" }))),
  );

  it.effect("runs app-global source reactions through runtime refresh services", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const result = yield* service.reconcile({
        scope: { kind: "app-global" },
        domains: ["extensions"],
        reason: "watcher-debounce",
      });

      assert.deepStrictEqual(packageRefreshes, [
        {
          scope: "app-global",
          packages: ["@svvyx/extensions", "@svvyx/workflows"],
          reason: "source-changed",
        },
      ]);
      assert.deepStrictEqual(contextRefreshes, [
        {
          scope: "workspace",
          workspaceId: workspaceOne,
          reason: "extension-source-changed",
        },
        {
          scope: "workspace",
          workspaceId: workspaceTwo,
          reason: "extension-source-changed",
        },
      ]);
      assert.deepStrictEqual(publishedInvalidations, [
        {
          scope: "app",
          invalidation: { model: "extensions" },
        },
      ]);
      assert.deepStrictEqual(result, {
        changedReadModelCount: 1,
        generatedPackageRefreshes: [
          generatedPackageRefresh(["@svvyx/extensions", "@svvyx/workflows"]),
        ],
        recoveryWorkIds: [],
      });
    }).pipe(
      Effect.provide(
        testLayer({
          acquiredWorkspaceIds: [workspaceOne, workspaceTwo],
          contextRefreshes,
          packageRefreshes,
          publishedInvalidations,
          reconcileEvent: sourceEvent(["extensions"]),
        }),
      ),
    );
  });

  it.effect(
    "applies committed source invalidation events through publication and reactions",
    () => {
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
      const publishedInvalidations: StateInvalidationDescriptor[] = [];
      const reconciliations: SourceReconcileRequest[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeSourceInvalidationService;

        const result = yield* service.applyCommittedScanEvent({
          scope: { kind: "app-global" },
          event: sourceEvent(["extensions"]),
        });

        assert.deepStrictEqual(reconciliations, []);
        assert.deepStrictEqual(packageRefreshes, [
          {
            scope: "app-global",
            packages: ["@svvyx/extensions", "@svvyx/workflows"],
            reason: "source-changed",
          },
        ]);
        assert.deepStrictEqual(contextRefreshes, [
          {
            scope: "workspace",
            workspaceId: workspaceOne,
            reason: "extension-source-changed",
          },
        ]);
        assert.deepStrictEqual(publishedInvalidations, [
          {
            scope: "app",
            invalidation: { model: "extensions" },
          },
        ]);
        assert.deepStrictEqual(result, {
          changedReadModelCount: 1,
          generatedPackageRefreshes: [
            generatedPackageRefresh(["@svvyx/extensions", "@svvyx/workflows"]),
          ],
          recoveryWorkIds: [],
        });
      }).pipe(
        Effect.provide(
          testLayer({
            acquiredWorkspaceIds: [workspaceOne],
            contextRefreshes,
            packageRefreshes,
            publishedInvalidations,
            reconciliations,
          }),
        ),
      );
    },
  );

  it.effect(
    "fails committed source invalidation event application before reactions when publication fails",
    () => {
      const contextRefreshes: RefreshGeneratedContextRequest[] = [];
      const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeSourceInvalidationService;

        const exit = yield* service
          .applyCommittedScanEvent({
            scope: { kind: "app-global" },
            event: sourceEvent(["extensions"]),
          })
          .pipe(Effect.exit);

        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const failure = exit.cause.reasons.find(Cause.isFailReason)?.error;
          assert.instanceOf(failure, RuntimeContractError);
          assert.strictEqual(
            failure.operation,
            "runtime.sourceInvalidation.applyCommittedScanEvent.publish",
          );
        }
        assert.deepStrictEqual(packageRefreshes, []);
        assert.deepStrictEqual(contextRefreshes, []);
      }).pipe(
        Effect.provide(
          testLayer({
            contextRefreshes,
            packageRefreshes,
            publishStateInvalidationsFailure: true,
          }),
        ),
      );
    },
  );

  it.effect("runs workspace source reactions through runtime context refresh service", () => {
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: InternalRefreshGeneratedPackagesRequest[] = [];
    const publishedInvalidations: StateInvalidationDescriptor[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeSourceInvalidationService;

      const result = yield* service.reconcile({
        scope: { kind: "workspace", workspaceId: workspaceOne },
        domains: ["external_instructions"],
        reason: "watcher-debounce",
      });

      assert.deepStrictEqual(packageRefreshes, []);
      assert.deepStrictEqual(contextRefreshes, [
        {
          scope: "workspace",
          workspaceId: workspaceOne,
          reason: "external-instruction-changed",
        },
      ]);
      assert.deepStrictEqual(publishedInvalidations, [
        {
          scope: "app",
          invalidation: { model: "extensions" },
        },
      ]);
      assert.deepStrictEqual(result, {
        changedReadModelCount: 1,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      });
    }).pipe(
      Effect.provide(
        testLayer({
          contextRefreshes,
          packageRefreshes,
          publishedInvalidations,
          reconcileEvent: sourceEvent(["external_instructions"]),
        }),
      ),
    );
  });
});

function testLayer(input: {
  readonly acquiredWorkspaceIds?: readonly WorkspaceId[];
  readonly classification?: "scan" | "scan-parent-domain" | "ignore" | "fail";
  readonly contextRefreshes?: RefreshGeneratedContextRequest[];
  readonly packageRefreshes?: InternalRefreshGeneratedPackagesRequest[];
  readonly publishedInvalidations?: StateInvalidationDescriptor[];
  readonly publishStateInvalidationsFailure?: boolean;
  readonly reconcileEvent?: SourceInvalidationEvent | null;
  readonly reconciliations?: SourceReconcileRequest[];
  readonly scheduledScans?: SourceReconcileRequest[];
}) {
  const reconciliations = input.reconciliations ?? [];
  const scheduledScans = input.scheduledScans ?? [];
  return layerRuntimeSourceInvalidationService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimeGeneratedContextRefreshService, {
          refresh: (request) =>
            Effect.sync(() => {
              input.contextRefreshes?.push(request);
            }),
        }),
        Layer.succeed(RuntimeGeneratedPackageRefreshService, {
          refresh: (request) =>
            Effect.sync(() => {
              input.packageRefreshes?.push(request);
              return generatedPackageRefresh(request.packages);
            }),
        }),
        Layer.succeed(
          RuntimeEventBus,
          RuntimeEventBus.of({
            publishLive: () =>
              Effect.die("runtime source invalidation service test does not publish live events"),
            publishStateInvalidations: ({ afterCommit }) =>
              input.publishStateInvalidationsFailure
                ? Effect.fail(
                    new RuntimeEventStreamError({
                      operation: "runtime.events.publishStateInvalidations",
                      reason: "stream-failed",
                      message: "Publication failed.",
                    }),
                  )
                : Effect.sync(() => {
                    input.publishedInvalidations?.push(...afterCommit);
                    return [];
                  }),
            subscribe: () => Effect.die("runtime source invalidation service test does not stream"),
          }),
        ),
        Layer.succeed(RuntimeSourceInvalidationScanPort, {
          classifyHint: () =>
            input.classification === "fail"
              ? Effect.fail(
                  new RuntimeContractError({
                    operation: "runtime.sourceInvalidation.hint",
                    reason: "invalid-input",
                    message: "Source invalidation hint path is outside configured source roots.",
                  }),
                )
              : Effect.succeed(input.classification ?? "scan"),
          listAcquiredWorkspaceIds: () => Effect.succeed(input.acquiredWorkspaceIds ?? []),
          requestScan: (request) =>
            Effect.sync(() => {
              scheduledScans.push(request);
            }),
          reconcile: (request) =>
            Effect.sync(() => {
              reconciliations.push(request);
              return input.reconcileEvent ?? null;
            }),
        }),
      ),
    ),
  );
}

function sourceEvent(domains: SourceInvalidationEvent["domains"]): SourceInvalidationEvent {
  return {
    domains: [...domains],
    reason: "test",
    sourceFingerprints: {
      extensions: "extensions_fingerprint",
      external_instructions: "external_instructions_fingerprint",
      host_snippets: "host_snippets_fingerprint",
      workflows: "workflows_fingerprint",
    },
    afterCommit: [
      {
        scope: "app",
        invalidation: { model: "extensions" },
      },
    ],
  };
}

function generatedPackageRefresh(
  packages: readonly GeneratedPackageName[],
): GeneratedPackagesRefreshResult {
  return {
    scope: "app-global",
    packages: packages.map((packageName) => ({
      packageName,
      action: "written",
    })),
    workspaceLinks: [],
    recoveryWorkIds: [],
  };
}
