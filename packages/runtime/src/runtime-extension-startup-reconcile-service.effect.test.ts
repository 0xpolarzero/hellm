import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import {
  type BuildRuntimeExtensionInput,
  type ExtensionCurrentBuildManifest,
  ExtensionError,
  type ExtensionId,
  type ExtensionRegistryObservation,
  type ExtensionRegistryObservationResult,
  type ExtensionSourceBuildObservation,
  type RefreshExtensionCliRequirementReadinessInput,
  RuntimeContractError,
  RuntimeEventStreamError,
  RuntimeExtensionStatePort,
  type RuntimeExtensionStatePortService,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import {
  Extensions,
  type ExtensionsService,
  type ScaffoldMissingBuiltinSourcesResult,
} from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeExtensionBuildService,
  type RuntimeExtensionBuildServiceService,
} from "./runtime-extension-build-service";
import { makeRuntimeExtensionStartupReconcileService } from "./runtime-extension-startup-reconcile-service";

const REQUIRED_BUILTIN_IDS = [
  "artifacts",
  "cx",
  "extension-managing",
  "smithers",
  "web",
  "workflows",
] as const;
const requiredBuiltinIds = REQUIRED_BUILTIN_IDS.map((id) => id as ExtensionId);
const extensionsInvalidation = {
  scope: "app",
  invalidation: { model: "extensions" },
} satisfies StateInvalidationDescriptor;
const defaultScaffold = {
  materializedExtensionIds: ["cx", "web", "smithers"].map((id) => id as ExtensionId),
  existingExtensionIds: [],
  appNativeExtensionIds: ["extension-managing", "workflows", "artifacts"].map(
    (id) => id as ExtensionId,
  ),
} satisfies ScaffoldMissingBuiltinSourcesResult;

describe("RuntimeExtensionStartupReconcileService", () => {
  it.effect(
    "scaffolds every source, builds the six fresh required builtins, and publishes committed evidence",
    () => {
      const operations: string[] = [];
      const buildInputs: BuildRuntimeExtensionInput[] = [];
      const published: StateInvalidationDescriptor[][] = [];
      const registry = makeRegistryObservation(
        requiredBuiltinIds.map((extensionId) => registryRecord(extensionId)),
      );
      const initialBuilds = buildObservation(registry, () => "missing");
      const finalBuilds = buildObservation(registry, () => "current");

      return Effect.gen(function* () {
        const service = yield* makeRuntimeExtensionStartupReconcileService();
        const receipt = yield* service.reconcile;

        assert.deepStrictEqual(receipt, {
          scaffold: defaultScaffold,
          builtExtensionIds: requiredBuiltinIds,
          readyExtensionIds: requiredBuiltinIds,
        });
        assert.deepStrictEqual(
          buildInputs.map((input) => input.extensionId),
          requiredBuiltinIds,
        );
        assert.deepStrictEqual(operations, [
          "scaffold",
          "observe-registry:initial",
          "commit-registry:initial",
          "publish",
          "observe-builds:initial",
          "commit-builds:initial",
          "publish",
          ...requiredBuiltinIds.map((id) => `build:${id}`),
          "observe-registry:final",
          "commit-registry:final",
          "publish",
          "observe-builds:final",
          "commit-builds:final",
          "publish",
          "probe-readiness",
          "commit-readiness",
          "publish",
        ]);
        assert.strictEqual(published.length, 5);
        assert.isTrue(published.every((batch) => batch[0] === extensionsInvalidation));
      }).pipe(
        Effect.provide(
          testLayer({
            operations,
            buildInputs,
            published,
            initialRegistry: registry,
            finalRegistry: registry,
            initialBuilds,
            finalBuilds,
          }),
        ),
      );
    },
  );

  it.effect("does not rebuild current required builtins", () => {
    const operations: string[] = [];
    const buildInputs: BuildRuntimeExtensionInput[] = [];
    const registry = makeRegistryObservation(
      requiredBuiltinIds.map((extensionId) => registryRecord(extensionId)),
    );
    const currentBuilds = buildObservation(registry, () => "current");

    return Effect.gen(function* () {
      const service = yield* makeRuntimeExtensionStartupReconcileService();
      const receipt = yield* service.reconcile;

      assert.deepStrictEqual(receipt.builtExtensionIds, []);
      assert.deepStrictEqual(receipt.readyExtensionIds, requiredBuiltinIds);
      assert.deepStrictEqual(buildInputs, []);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          buildInputs,
          initialRegistry: registry,
          finalRegistry: registry,
          initialBuilds: currentBuilds,
          finalBuilds: currentBuilds,
        }),
      ),
    );
  });

  it.effect("never auto-builds customized builtin or user sources", () => {
    const operations: string[] = [];
    const buildInputs: BuildRuntimeExtensionInput[] = [];
    const artifacts = registryRecord("artifacts" as ExtensionId);
    const customized = registryRecord("cx" as ExtensionId, { customized: true });
    const user = registryRecord("custom-user" as ExtensionId, { category: "user" });
    const registry = makeRegistryObservation([artifacts, customized, user]);
    const initialBuilds = buildObservation(registry, (extensionId) =>
      extensionId === artifacts.extensionId ? "current" : "missing",
    );

    return Effect.gen(function* () {
      const service = yield* makeRuntimeExtensionStartupReconcileService();
      const receipt = yield* service.reconcile;

      assert.deepStrictEqual(buildInputs, []);
      assert.deepStrictEqual(receipt.readyExtensionIds, [artifacts.extensionId]);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          buildInputs,
          initialRegistry: registry,
          finalRegistry: registry,
          initialBuilds,
          finalBuilds: initialBuilds,
        }),
      ),
    );
  });

  it.effect(
    "uses a deterministic build request id that changes with the source fingerprint",
    () => {
      const buildInputs: BuildRuntimeExtensionInput[] = [];
      const run = (sourceFingerprint: string) => {
        const operations: string[] = [];
        const record = registryRecord("artifacts" as ExtensionId, { sourceFingerprint });
        const registry = makeRegistryObservation([record]);
        return Effect.gen(function* () {
          const service = yield* makeRuntimeExtensionStartupReconcileService();
          yield* service.reconcile;
        }).pipe(
          Effect.provide(
            testLayer({
              operations,
              buildInputs,
              initialRegistry: registry,
              finalRegistry: registry,
              initialBuilds: buildObservation(registry, () => "missing"),
              finalBuilds: buildObservation(registry, () => "current"),
            }),
          ),
        );
      };

      return Effect.gen(function* () {
        yield* run(hash("a"));
        yield* run(hash("a"));
        yield* run(hash("b"));

        assert.strictEqual(buildInputs[0]?.clientRequestId, buildInputs[1]?.clientRequestId);
        assert.notStrictEqual(buildInputs[1]?.clientRequestId, buildInputs[2]?.clientRequestId);
        assert.match(String(buildInputs[0]?.clientRequestId), /sha256:a{64}$/);
        assert.match(String(buildInputs[2]?.clientRequestId), /sha256:b{64}$/);
      });
    },
  );

  it.effect("fails closed when a required packaged builtin is still not ready after build", () => {
    const operations: string[] = [];
    const buildInputs: BuildRuntimeExtensionInput[] = [];
    const record = registryRecord("artifacts" as ExtensionId);
    const registry = makeRegistryObservation([record]);

    return Effect.gen(function* () {
      const service = yield* makeRuntimeExtensionStartupReconcileService();
      const exit = yield* Effect.exit(service.reconcile);

      assert.isTrue(Exit.isFailure(exit));
      if (Exit.isSuccess(exit)) return;
      const failure = Cause.findErrorOption(exit.cause);
      assert.isTrue(failure._tag === "Some");
      if (failure._tag === "None") return;
      assert.isTrue(failure.value instanceof RuntimeContractError);
      assert.strictEqual(failure.value.reason, "target-not-ready");
      assert.strictEqual(
        failure.value.operation,
        "runtime.extensions.startupReconcile.final.assertReady",
      );
      assert.match(failure.value.message, /artifacts/);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          buildInputs,
          initialRegistry: registry,
          finalRegistry: registry,
          initialBuilds: buildObservation(registry, () => "missing"),
          finalBuilds: buildObservation(registry, () => "stale"),
        }),
      ),
    );
  });

  it.effect("maps scaffold, build, and publication failures to RuntimeContractError", () => {
    const record = registryRecord("artifacts" as ExtensionId);
    const registry = makeRegistryObservation([record]);
    const missing = buildObservation(registry, () => "missing");
    const current = buildObservation(registry, () => "current");
    const run = (options: Partial<HarnessOptions>) =>
      Effect.gen(function* () {
        const service = yield* makeRuntimeExtensionStartupReconcileService();
        return yield* Effect.exit(service.reconcile);
      }).pipe(
        Effect.provide(
          testLayer({
            operations: [],
            buildInputs: [],
            initialRegistry: registry,
            finalRegistry: registry,
            initialBuilds: missing,
            finalBuilds: current,
            ...options,
          }),
        ),
      );

    return Effect.gen(function* () {
      const scaffoldFailure = yield* run({
        scaffold: () =>
          Effect.fail(
            new ExtensionError({
              operation: "test.scaffold",
              reason: "not-found",
              message: "Missing packaged template.",
            }),
          ),
      });
      const buildFailure = yield* run({
        build: () =>
          Effect.fail(
            new RuntimeContractError({
              operation: "test.build",
              reason: "state-conflict",
              message: "Build failed.",
            }),
          ),
      });
      const publishFailure = yield* run({ failPublication: true });

      for (const exit of [scaffoldFailure, buildFailure, publishFailure]) {
        assert.isTrue(Exit.isFailure(exit));
        if (Exit.isSuccess(exit)) continue;
        const failure = Cause.findErrorOption(exit.cause);
        assert.isTrue(failure._tag === "Some");
        if (failure._tag === "Some") {
          assert.isTrue(failure.value instanceof RuntimeContractError);
        }
      }
    });
  });
});

interface HarnessOptions {
  readonly operations: string[];
  readonly buildInputs: BuildRuntimeExtensionInput[];
  readonly published?: StateInvalidationDescriptor[][];
  readonly initialRegistry: ExtensionRegistryObservationResult;
  readonly finalRegistry: ExtensionRegistryObservationResult;
  readonly initialBuilds: {
    readonly registryAggregateFingerprint: string;
    readonly observations: readonly ExtensionSourceBuildObservation[];
  };
  readonly finalBuilds: {
    readonly registryAggregateFingerprint: string;
    readonly observations: readonly ExtensionSourceBuildObservation[];
  };
  readonly scaffold?: ExtensionsService["builtin"]["scaffoldMissing"];
  readonly build?: RuntimeExtensionBuildServiceService["build"];
  readonly failPublication?: boolean;
}

function testLayer(options: HarnessOptions) {
  let registryCall = 0;
  let buildObservationCall = 0;
  const extensions = Extensions.of({
    builtin: {
      scaffoldMissing:
        options.scaffold ??
        (() =>
          Effect.sync(() => {
            options.operations.push("scaffold");
            return defaultScaffold;
          })),
    },
    registry: {
      observe: () =>
        Effect.sync(() => {
          const phase = registryCall++ === 0 ? "initial" : "final";
          options.operations.push(`observe-registry:${phase}`);
          return phase === "initial" ? options.initialRegistry : options.finalRegistry;
        }),
    },
    builds: {
      observeCurrent: () =>
        Effect.sync(() => {
          const phase = buildObservationCall++ === 0 ? "initial" : "final";
          options.operations.push(`observe-builds:${phase}`);
          return phase === "initial" ? options.initialBuilds : options.finalBuilds;
        }),
    },
    dependencies: {
      refreshReadiness: ({ registryObservation }: RefreshExtensionCliRequirementReadinessInput) =>
        Effect.sync(() => {
          options.operations.push("probe-readiness");
          return {
            registryAggregateFingerprint: registryObservation.aggregateFingerprint,
            readiness: [],
          };
        }),
    },
  } as unknown as ExtensionsService);

  return Layer.mergeAll(
    Layer.succeed(Extensions, extensions),
    Layer.succeed(RuntimeExtensionStatePort, extensionState(options.operations)),
    Layer.succeed(RuntimeExtensionBuildService, {
      build:
        options.build ??
        ((input) =>
          Effect.sync(() => {
            options.operations.push(`build:${input.extensionId}`);
            options.buildInputs.push(input);
            return {
              attemptId: `extension-build-attempt:${input.extensionId}:${"d".repeat(64)}` as never,
              registryAggregateFingerprint: options.initialRegistry.aggregateFingerprint,
              manifest: currentManifest(
                input.extensionId,
                sourceFingerprintFor(options.initialBuilds, input.extensionId),
              ),
            };
          })),
      buildOutcome: () => Effect.die("unused"),
    }),
    Layer.succeed(RuntimeEventBus, {
      publishLive: () => Effect.die("unused"),
      publishStateInvalidations: ({ afterCommit }) =>
        options.failPublication
          ? Effect.fail(
              new RuntimeEventStreamError({
                operation: "test.publish",
                reason: "stream-failed",
                message: "Publication failed.",
              }),
            )
          : Effect.sync(() => {
              options.operations.push("publish");
              options.published?.push([...afterCommit]);
              return [];
            }),
      subscribe: () => Effect.die("unused"),
    }),
  );
}

function extensionState(operations: string[]): RuntimeExtensionStatePortService {
  let registryCommit = 0;
  let buildsCommit = 0;
  return {
    readBuildAttemptByClientRequestId: () => Effect.die("unused"),
    reconcileRegistryObservation: (input) =>
      Effect.sync(() => {
        operations.push(`commit-registry:${registryCommit++ === 0 ? "initial" : "final"}`);
        return {
          value: { observation: input.observation, observedAt: input.observedAt },
          afterCommit: [extensionsInvalidation],
        };
      }),
    reconcileBuildEvidence: (input) =>
      Effect.sync(() => {
        operations.push(`commit-builds:${buildsCommit++ === 0 ? "initial" : "final"}`);
        return {
          value: {
            changed: true,
            changedExtensionIds: input.observations.map((entry) => entry.extensionId),
          },
          afterCommit: [extensionsInvalidation],
        };
      }),
    startBuildAttempt: () => Effect.die("unused"),
    recordBuildSuccess: () => Effect.die("unused"),
    recordBuildFailure: () => Effect.die("unused"),
    recordDependencyApproval: () => Effect.die("unused"),
    recordDependencyReadiness: () => Effect.die("unused"),
    reconcileDependencyReadiness: (input) =>
      Effect.sync(() => {
        operations.push("commit-readiness");
        return {
          value: { changed: true, readiness: input.readiness },
          afterCommit: [extensionsInvalidation],
        };
      }),
  };
}

function makeRegistryObservation(
  observations: readonly ExtensionRegistryObservation[],
): ExtensionRegistryObservationResult {
  return {
    aggregateFingerprint: "registry:startup-reconcile:test",
    observations,
    diagnostics: [],
  };
}

function registryRecord(
  extensionId: ExtensionId,
  options: {
    readonly category?: "builtin" | "user";
    readonly customized?: boolean;
    readonly sourceFingerprint?: string;
  } = {},
): ExtensionRegistryObservation {
  return {
    extensionId,
    category: options.category ?? "builtin",
    interfaceKind: "svvyx",
    svvyxImplementation: { kind: "source-runtime", sourceRelativePath: "source/index.ts" },
    usagePolicy: {
      canonicalOrder: 0,
      baselineUsage: {
        orchestrator: "loaded",
        handler: "loaded",
        "workflow-task": "loaded",
      },
      networkAccess: "not-required",
      configurable: true,
      fixedReason: null,
    },
    buildRequirement: "required",
    title: String(extensionId),
    description: `${extensionId} test extension`,
    customized: options.customized ?? false,
    materializationPlan: null,
    capabilities: {
      resettable: options.category !== "user",
      deletable: options.category === "user",
      typescriptApiEnabled: false,
      materializationRequired: false,
    },
    contributors: [],
    tooling: [],
    cliDeclarations: [],
    envDeclarations: [],
    dependencyDeclarations: [],
    sourceFingerprint: options.sourceFingerprint ?? hash("a"),
    diagnostics: [],
  };
}

function buildObservation(
  registry: ExtensionRegistryObservationResult,
  status: (extensionId: ExtensionId) => ExtensionSourceBuildObservation["currentBuildStatus"],
) {
  return {
    registryAggregateFingerprint: registry.aggregateFingerprint,
    observations: registry.observations.map((record) => {
      const currentBuildStatus = status(record.extensionId);
      const sourceFingerprint = record.sourceFingerprint as NonNullable<
        ExtensionSourceBuildObservation["sourceFingerprint"]
      >;
      return {
        extensionId: record.extensionId,
        category: record.category,
        buildRequirement: record.buildRequirement,
        sourceStatus: "materialized",
        sourceFingerprint,
        currentBuildStatus,
        currentBuild:
          currentBuildStatus === "current"
            ? currentManifest(record.extensionId, sourceFingerprint)
            : null,
        buildRequired: currentBuildStatus !== "current",
        diagnostics: [],
      } satisfies ExtensionSourceBuildObservation;
    }),
  };
}

function currentManifest(
  extensionId: ExtensionId,
  sourceFingerprint: NonNullable<ExtensionSourceBuildObservation["sourceFingerprint"]>,
): ExtensionCurrentBuildManifest {
  return {
    schemaVersion: 1,
    buildId: `extension-build:${extensionId}:${"b".repeat(64)}` as never,
    extensionId,
    interfaceKind: "svvyx",
    sourceFingerprint,
    contextFingerprint: hash("c") as never,
    outputFingerprint: hash("d") as never,
    contextReady: true,
    generatedFiles: [],
    builtAt: "2026-07-13T00:00:00.000Z" as ExtensionCurrentBuildManifest["builtAt"],
  };
}

function sourceFingerprintFor(
  observation: HarnessOptions["initialBuilds"],
  extensionId: ExtensionId,
): NonNullable<ExtensionSourceBuildObservation["sourceFingerprint"]> {
  const sourceFingerprint = observation.observations.find(
    (entry) => entry.extensionId === extensionId,
  )?.sourceFingerprint;
  if (sourceFingerprint === null || sourceFingerprint === undefined) {
    throw new Error(`Missing source fingerprint for ${extensionId}.`);
  }
  return sourceFingerprint;
}

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}
