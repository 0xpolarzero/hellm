import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import {
  ExtensionError,
  RuntimeEventStreamError,
  RuntimeExtensionStatePort,
  type ExtensionBuildAttemptRecord,
  type ExtensionCurrentBuildManifest,
  type ExtensionId,
  type ExtensionRegistryObservationResult,
  type ExtensionSourceBuildObservation,
  type RuntimeExtensionStatePortService,
  type BuildRuntimeExtensionInput,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";
import {
  layerRuntimeExtensionBuildService,
  RuntimeExtensionBuildService,
} from "./runtime-extension-build-service";

const hash = (character: string) => `sha256:${character.repeat(64)}`;
const extensionId = "linear" as ExtensionId;
const buildInput = (request: string): BuildRuntimeExtensionInput => ({
  extensionId,
  clientRequestId: request as BuildRuntimeExtensionInput["clientRequestId"],
});
const sourceFingerprint = hash("a") as NonNullable<
  ExtensionSourceBuildObservation["sourceFingerprint"]
>;
const registryObservation = {
  aggregateFingerprint: "registry-extension-build-test",
  observations: [
    {
      extensionId,
      category: "user",
      interfaceKind: "svvyx",
      svvyxImplementation: {
        kind: "source-runtime",
        sourceRelativePath: "source/index.ts",
      },
      title: "Linear",
      description: "Linear test extension.",
      customized: true,
      usagePolicy: {
        canonicalOrder: 0,
        baselineUsage: {
          orchestrator: "loaded",
          handler: "unavailable",
          "workflow-task": "loaded",
        },
        networkAccess: "not-required",
        configurable: true,
        fixedReason: null,
      },
      buildRequirement: "required",
      materializationPlan: null,
      capabilities: {
        resettable: false,
        deletable: true,
        typescriptApiEnabled: true,
        materializationRequired: false,
      },
      contributors: [],
      tooling: [],
      cliDeclarations: [],
      envDeclarations: [],
      dependencyDeclarations: [],
      sourceFingerprint,
      diagnostics: [],
    },
  ],
  diagnostics: [],
} satisfies ExtensionRegistryObservationResult;
const sourceObservation = {
  extensionId,
  category: "user",
  buildRequirement: "required",
  sourceStatus: "materialized",
  sourceFingerprint,
  currentBuildStatus: "missing",
  currentBuild: null,
  buildRequired: true,
  diagnostics: [],
} satisfies ExtensionSourceBuildObservation;
const manifest = {
  schemaVersion: 1,
  buildId: `extension-build:linear:${"b".repeat(64)}`,
  extensionId,
  interfaceKind: "svvyx",
  sourceFingerprint,
  contextFingerprint: hash("c"),
  outputFingerprint: hash("d"),
  contextReady: true,
  generatedFiles: [],
  builtAt: "1970-01-01T00:00:00.000Z",
} as unknown as ExtensionCurrentBuildManifest;

function attemptRecord(
  status: "running" | "succeeded" | "failed",
  requestId: string,
): ExtensionBuildAttemptRecord {
  return {
    attemptId: `extension-build-attempt:linear:${"e".repeat(64)}`,
    clientRequestId: requestId,
    extensionId,
    registryAggregateFingerprint: registryObservation.aggregateFingerprint,
    sourceFingerprint,
    status,
    failureReason: status === "failed" ? "validation" : null,
    successfulBuildId: status === "succeeded" ? manifest.buildId : null,
    startedAt: "1970-01-01T00:00:00.000Z",
    finishedAt: status === "running" ? null : "1970-01-01T00:00:01.000Z",
  } as ExtensionBuildAttemptRecord;
}

describe("RuntimeExtensionBuildService", () => {
  it.effect(
    "commits observation, attempt, and success before publishing exact invalidations",
    () => {
      const operations: string[] = [];
      const published: StateInvalidationDescriptor[][] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeExtensionBuildService;
        const result = yield* service.build(buildInput("build-success"));

        assert.strictEqual(
          result.registryAggregateFingerprint,
          registryObservation.aggregateFingerprint,
        );
        assert.deepStrictEqual(result.manifest, manifest);
        assert.match(result.attemptId, /^extension-build-attempt:linear:[0-9a-f]{64}$/);
        assert.deepStrictEqual(operations, [
          "registry-observe",
          "registry-commit",
          "publish:registry",
          "build-observe",
          "build-evidence-commit",
          "publish:evidence",
          "attempt-start",
          "publish:start",
          "build",
          "success",
          "publish:success",
        ]);
        assert.strictEqual(published.length, 4);
      }).pipe(Effect.provide(testLayer({ operations, published })));
    },
  );

  it.effect("records a classified failure and never records success", () => {
    const operations: string[] = [];
    const failureReasons: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionBuildService;
      const exit = yield* Effect.exit(service.build(buildInput("build-failure")));

      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(failureReasons, ["validation"]);
      assert.include(operations, "failure");
      assert.notInclude(operations, "success");
      assert.strictEqual(operations.at(-1), "publish:failure");
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          failureReasons,
          build: () =>
            Effect.fail(
              new ExtensionError({
                extensionId,
                operation: "extensions.builds.build",
                reason: "invalid-input",
                message: "invalid source",
              }),
            ),
        }),
      ),
    );
  });

  it.effect(
    "returns the allocated attempt and exact failure from the internal outcome seam",
    () => {
      const operations: string[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeExtensionBuildService;
        const outcome = yield* service.buildOutcome(buildInput("build-outcome"));
        assert.strictEqual(outcome.status, "failed");
        if (outcome.status !== "failed") return;
        assert.match(outcome.attemptId, /^extension-build-attempt:linear:[0-9a-f]{64}$/);
        assert.strictEqual(outcome.failureReason, "validation");
      }).pipe(
        Effect.provide(
          testLayer({
            operations,
            build: () =>
              Effect.fail(
                new ExtensionError({
                  extensionId,
                  operation: "extensions.builds.build",
                  reason: "invalid-input",
                  message: "invalid source",
                }),
              ),
          }),
        ),
      );
    },
  );

  it.effect("returns not-started without inventing an attempt id", () => {
    const operations: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionBuildService;
      const outcome = yield* service.buildOutcome(buildInput("build-not-started"));
      assert.deepStrictEqual(outcome, { status: "not-started", failureReason: "stale-state" });
      assert.notInclude(operations, "attempt-start");
    }).pipe(Effect.provide(testLayer({ operations, failRegistryObservation: true })));
  });

  for (const [extensionReason, persistedReason] of [
    ["timed-out", "timed-out"],
    ["process-failed", "process-failed"],
    ["output-invalid", "output-invalid"],
  ] as const) {
    it.effect(`persists the exact ${extensionReason} failure classification`, () => {
      const operations: string[] = [];
      const failureReasons: string[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeExtensionBuildService;
        yield* Effect.exit(service.build(buildInput(`build-${extensionReason}`)));
        assert.deepStrictEqual(failureReasons, [persistedReason]);
      }).pipe(
        Effect.provide(
          testLayer({
            operations,
            failureReasons,
            build: () =>
              Effect.fail(
                new ExtensionError({
                  extensionId,
                  operation: "extensions.builds.build",
                  reason: extensionReason,
                  message: "classified build failure",
                }),
              ),
          }),
        ),
      );
    });
  }

  it.effect("terminalizes once when start invalidation publication fails", () => {
    const operations: string[] = [];
    const failureReasons: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionBuildService;
      const exit = yield* Effect.exit(service.build(buildInput("build-publish-failure")));
      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(failureReasons, ["unknown"]);
      assert.strictEqual(operations.filter((operation) => operation === "failure").length, 1);
      assert.notInclude(operations, "build");
      assert.strictEqual(operations.at(-1), "publish:failure");
    }).pipe(Effect.provide(testLayer({ operations, failureReasons, failPublishLabel: "start" })));
  });

  it.effect("replays succeeded, failed, and running requests without allocating new attempts", () =>
    Effect.gen(function* () {
      const succeededOperations: string[] = [];
      const succeededAttempt = attemptRecord("succeeded", "replay-succeeded");
      const succeededService = yield* RuntimeExtensionBuildService.pipe(
        Effect.provide(
          testLayer({
            operations: succeededOperations,
            replayAttempt: succeededAttempt,
            observedSource: {
              ...sourceObservation,
              currentBuildStatus: "current",
              currentBuild: manifest,
              buildRequired: false,
            },
          }),
        ),
      );
      const succeeded = yield* succeededService.build(buildInput("replay-succeeded"));
      assert.strictEqual(succeeded.attemptId, succeededAttempt.attemptId);
      assert.notInclude(succeededOperations, "attempt-start");
      assert.notInclude(succeededOperations, "build");

      const failedOperations: string[] = [];
      const failedService = yield* RuntimeExtensionBuildService.pipe(
        Effect.provide(
          testLayer({
            operations: failedOperations,
            replayAttempt: attemptRecord("failed", "replay-failed"),
          }),
        ),
      );
      const failed = yield* failedService.buildOutcome(buildInput("replay-failed"));
      assert.deepStrictEqual(
        failed.status === "failed" ? failed.failureReason : null,
        "validation",
      );
      assert.deepStrictEqual(failedOperations, []);

      const runningOperations: string[] = [];
      const runningAttempt = attemptRecord("running", "replay-running");
      const runningService = yield* RuntimeExtensionBuildService.pipe(
        Effect.provide(testLayer({ operations: runningOperations, replayAttempt: runningAttempt })),
      );
      const resumed = yield* runningService.build(buildInput("replay-running"));
      assert.strictEqual(resumed.attemptId, runningAttempt.attemptId);
      assert.include(runningOperations, "attempt-start");
      assert.include(runningOperations, "build");
    }),
  );

  it.effect("rejects conflicting client request reuse before observing or building", () => {
    const operations: string[] = [];
    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionBuildService;
      const exit = yield* Effect.exit(service.build(buildInput("replay-conflict")));
      assert.isTrue(Exit.isFailure(exit));
      assert.deepStrictEqual(operations, []);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          replayAttempt: {
            ...attemptRecord("running", "replay-conflict"),
            extensionId: "other" as ExtensionId,
          },
        }),
      ),
    );
  });

  it.effect("serializes concurrent builds for the same extension id", () => {
    const operations: string[] = [];
    let active = 0;
    let maximumActive = 0;
    let buildCount = 0;
    let firstEntered!: Deferred.Deferred<void>;
    let releaseFirst!: Deferred.Deferred<void>;
    return Effect.gen(function* () {
      firstEntered = yield* Deferred.make<void>();
      releaseFirst = yield* Deferred.make<void>();
      const service = yield* RuntimeExtensionBuildService;
      const first = yield* Effect.forkChild(service.build(buildInput("build-concurrent-one")));
      yield* Deferred.await(firstEntered);
      const second = yield* Effect.forkChild(service.build(buildInput("build-concurrent-two")));
      yield* Effect.yieldNow;
      assert.strictEqual(buildCount, 1);
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);
      assert.strictEqual(maximumActive, 1);
      assert.strictEqual(buildCount, 2);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          build: () =>
            Effect.gen(function* () {
              buildCount += 1;
              active += 1;
              maximumActive = Math.max(maximumActive, active);
              if (buildCount === 1) {
                yield* Deferred.succeed(firstEntered, undefined);
                yield* Deferred.await(releaseFirst);
              }
              active -= 1;
              return {
                registryAggregateFingerprint: registryObservation.aggregateFingerprint,
                manifest,
              };
            }),
        }),
      ),
    );
  });
});

function testLayer(input: {
  operations: string[];
  published?: StateInvalidationDescriptor[][];
  failureReasons?: string[];
  failPublishLabel?: string;
  failRegistryObservation?: boolean;
  build?: ExtensionsService["builds"]["build"];
  replayAttempt?: ExtensionBuildAttemptRecord | null;
  observedSource?: ExtensionSourceBuildObservation;
}) {
  const pendingPublishLabels: string[] = [];
  const descriptor = (): StateInvalidationDescriptor => ({
    scope: "app",
    invalidation: { model: "extensions", ids: [extensionId] },
  });
  const mutation = <A>(value: A, label: string) => {
    pendingPublishLabels.push(label);
    return { value, afterCommit: [descriptor()] };
  };
  const state = {
    readBuildAttemptByClientRequestId: () => Effect.succeed(input.replayAttempt ?? null),
    reconcileRegistryObservation: ({ observation, observedAt }) =>
      Effect.sync(() => {
        input.operations.push("registry-commit");
        return mutation({ observation, observedAt }, "registry");
      }),
    reconcileBuildEvidence: () =>
      Effect.sync(() => {
        input.operations.push("build-evidence-commit");
        return mutation({ changed: true, changedExtensionIds: [extensionId] }, "evidence");
      }),
    startBuildAttempt: (attempt) =>
      Effect.sync(() => {
        input.operations.push("attempt-start");
        return mutation(
          {
            ...attempt,
            status: "running",
            failureReason: null,
            successfulBuildId: null,
            finishedAt: null,
          } as ExtensionBuildAttemptRecord,
          "start",
        );
      }),
    recordBuildSuccess: (attempt) =>
      Effect.sync(() => {
        input.operations.push("success");
        return mutation(
          {
            attemptId: attempt.attemptId,
            clientRequestId: attempt.clientRequestId,
            extensionId: attempt.extensionId,
            registryAggregateFingerprint: attempt.registryAggregateFingerprint,
            sourceFingerprint: attempt.sourceFingerprint,
            status: "succeeded",
            failureReason: null,
            successfulBuildId: attempt.manifest.buildId,
            startedAt: attempt.finishedAt,
            finishedAt: attempt.finishedAt,
          } as ExtensionBuildAttemptRecord,
          "success",
        );
      }),
    recordBuildFailure: (attempt) =>
      Effect.sync(() => {
        input.operations.push("failure");
        input.failureReasons?.push(attempt.failureReason);
        return mutation(
          {
            ...attempt,
            status: "failed",
            successfulBuildId: null,
            startedAt: attempt.finishedAt,
          } as ExtensionBuildAttemptRecord,
          "failure",
        );
      }),
    reconcileDependencyReadiness: () => Effect.die("unused"),
    recordDependencyApproval: () => Effect.die("unused"),
    recordDependencyReadiness: () => Effect.die("unused"),
  } satisfies RuntimeExtensionStatePortService;
  const extensions = {
    registry: {
      observe: () =>
        input.failRegistryObservation
          ? Effect.fail(
              new ExtensionError({
                operation: "extensions.registry.observe",
                reason: "execution-failed",
                message: "registry unavailable",
              }),
            )
          : Effect.sync(() => {
              input.operations.push("registry-observe");
              return registryObservation;
            }),
    },
    builds: {
      observeCurrent: () =>
        Effect.sync(() => {
          input.operations.push("build-observe");
          return {
            registryAggregateFingerprint: registryObservation.aggregateFingerprint,
            observations: [input.observedSource ?? sourceObservation],
          };
        }),
      build:
        input.build ??
        (() =>
          Effect.sync(() => {
            input.operations.push("build");
            return {
              registryAggregateFingerprint: registryObservation.aggregateFingerprint,
              manifest,
            };
          })),
    },
  } as unknown as ExtensionsService;

  return layerRuntimeExtensionBuildService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Extensions, extensions),
        Layer.succeed(RuntimeExtensionStatePort, state),
        Layer.succeed(RuntimeEventBus, {
          publishLive: () => Effect.die("unused"),
          publishStateInvalidations: ({ afterCommit }) =>
            Effect.suspend(() => {
              const label = pendingPublishLabels.shift() ?? "empty";
              input.operations.push(`publish:${label}`);
              if (label === input.failPublishLabel) {
                return Effect.fail(
                  new RuntimeEventStreamError({
                    operation: "test.publish",
                    reason: "stream-failed",
                    message: "publication failed",
                  }),
                );
              }
              input.published?.push([...afterCommit]);
              return Effect.succeed([]);
            }),
          subscribe: () => Effect.die("unused"),
        }),
        Layer.succeed(Crypto.Crypto, {
          randomBytes: (size: number) => Effect.succeed(new Uint8Array(size).fill(1)),
        } as unknown as Crypto.Crypto),
      ),
    ),
  );
}
