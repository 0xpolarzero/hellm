import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import {
  AppLogWritePort,
  ExtensionError,
  RuntimeContractError,
  type ConfigureExtensionTypescriptApiInput,
  type ConfigureExtensionTypescriptApiResult,
  type CreateExtensionSourceInput,
  type CreateExtensionSourceResult,
  type ExtensionBuildAttemptId,
  type ExtensionSourceMutationId,
  type ResetExtensionInstructionsInput,
  type ResetExtensionInstructionsResult,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeExtensionBuildService,
  type RuntimeExtensionBuildServiceService,
} from "./runtime-extension-build-service";
import {
  layerRuntimeExtensionLifecycleService,
  RuntimeExtensionLifecycleService,
} from "./runtime-extension-lifecycle-service";
import { layerRuntimeExtensionSourceCoordinator } from "./runtime-extension-source-coordinator";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";

const createInput = {
  id: "notes" as never,
  title: "Notes",
  description: "Project notes",
  interfaceKind: "instructions",
  typescriptApiEnabled: false,
} satisfies CreateExtensionSourceInput;

const createMutationId = mutationId("notes", "a");
const createReceipt = {
  action: "created",
  mutationId: createMutationId,
  extensionId: "notes" as never,
  changed: true,
} satisfies CreateExtensionSourceResult;

const resetInput = {
  extensionId: "smithers" as never,
  scope: "instructions",
} satisfies ResetExtensionInstructionsInput;

const configureTypescriptApiInput = {
  workspaceId: "workspace_lifecycle_test" as never,
  extensionId: resetInput.extensionId,
  enabled: true,
} satisfies ConfigureExtensionTypescriptApiInput;

describe("RuntimeExtensionLifecycleService", () => {
  it.effect(
    "creates source before runtime reconciliation and log publication, then finalizes the journal",
    () => {
      const operations: string[] = [];
      return Effect.gen(function* () {
        const service = yield* RuntimeExtensionLifecycleService;
        const result = yield* service.create(createInput);

        assert.deepStrictEqual(result, createReceipt);
        assert.deepStrictEqual(operations, [
          "source:create",
          "runtime:reconcile",
          "log:append",
          "log:publish",
          `source:finalize:${createMutationId}`,
        ]);
      }).pipe(
        Effect.provide(
          testLayer({
            operations,
            createExtension: () =>
              Effect.sync(() => {
                operations.push("source:create");
                return createReceipt;
              }),
          }),
        ),
      );
    },
  );

  it.effect("skips reconciliation, journal finalization, and build for an unchanged reset", () => {
    const operations: string[] = [];
    const source = {
      action: "reset",
      mutationId: null,
      extensionId: resetInput.extensionId,
      scope: "instructions",
      changed: false,
    } satisfies ResetExtensionInstructionsResult;

    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionLifecycleService;
      const result = yield* service.reset(resetInput);

      assert.deepStrictEqual(result, {
        source,
        automaticBuild: { status: "skipped", reason: "source-unchanged" },
      });
      assert.deepStrictEqual(operations, ["source:reset"]);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          resetExtensionInstructions: () =>
            Effect.sync(() => {
              operations.push("source:reset");
              return source;
            }),
        }),
      ),
    );
  });

  it.effect("builds a changed reset and preserves the automatic-build failure evidence", () => {
    const operations: string[] = [];
    const resetMutationId = mutationId("smithers", "b");
    const buildAttemptId =
      `extension-build-attempt:smithers:${"c".repeat(64)}` as ExtensionBuildAttemptId;
    const source = {
      action: "reset",
      mutationId: resetMutationId,
      extensionId: resetInput.extensionId,
      scope: "instructions",
      changed: true,
    } satisfies ResetExtensionInstructionsResult;

    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionLifecycleService;
      const result = yield* service.reset(resetInput);

      assert.deepStrictEqual(result, {
        source,
        automaticBuild: {
          status: "failed",
          attemptId: buildAttemptId,
          failureReason: "validation",
        },
      });
      assert.deepStrictEqual(operations, [
        "source:reset",
        "runtime:reconcile",
        "log:append",
        "log:publish",
        `source:finalize:${resetMutationId}`,
        `runtime:build:extension-build:${resetMutationId}`,
      ]);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          resetExtensionInstructions: () =>
            Effect.sync(() => {
              operations.push("source:reset");
              return source;
            }),
          buildOutcome: (input) =>
            Effect.sync(() => {
              operations.push(`runtime:build:${input.clientRequestId}`);
              assert.strictEqual(input.extensionId, resetInput.extensionId);
              return {
                status: "failed" as const,
                attemptId: buildAttemptId,
                failureReason: "validation" as const,
              };
            }),
        }),
      ),
    );
  });

  it.effect(
    "serializes TypeScript API configuration and its reconciliation with lifecycle mutations",
    () => {
      const operations: string[] = [];
      let resetCalls = 0;
      let configureEntered!: Deferred.Deferred<void>;
      let releaseConfigure!: Deferred.Deferred<void>;
      const configured = {
        extensionId: configureTypescriptApiInput.extensionId,
        enabled: true,
        changed: true,
        reconcileRequired: true,
      } satisfies ConfigureExtensionTypescriptApiResult;
      const resetSource = {
        action: "reset",
        mutationId: null,
        extensionId: resetInput.extensionId,
        scope: "instructions",
        changed: false,
      } satisfies ResetExtensionInstructionsResult;

      return Effect.gen(function* () {
        configureEntered = yield* Deferred.make<void>();
        releaseConfigure = yield* Deferred.make<void>();
        const service = yield* RuntimeExtensionLifecycleService;
        const configure = yield* Effect.forkChild(
          service.configureTypescriptApi(configureTypescriptApiInput),
        );
        yield* Deferred.await(configureEntered);
        const reset = yield* Effect.forkChild(service.reset(resetInput));
        yield* Effect.yieldNow;

        assert.strictEqual(resetCalls, 0);
        yield* Deferred.succeed(releaseConfigure, undefined);
        assert.deepStrictEqual(yield* Fiber.join(configure), configured);
        assert.deepStrictEqual((yield* Fiber.join(reset)).source, resetSource);
        assert.strictEqual(resetCalls, 1);
        assert.deepStrictEqual(operations, [
          "source:configure-typescript-api",
          "runtime:reconcile",
          "log:append",
          "log:publish",
          "source:reset",
        ]);
      }).pipe(
        Effect.provide(
          testLayer({
            operations,
            configureTypescriptApi: () =>
              Effect.gen(function* () {
                operations.push("source:configure-typescript-api");
                yield* Deferred.succeed(configureEntered, undefined);
                yield* Deferred.await(releaseConfigure);
                return configured;
              }),
            resetExtensionInstructions: () =>
              Effect.sync(() => {
                resetCalls += 1;
                operations.push("source:reset");
                return resetSource;
              }),
          }),
        ),
      );
    },
  );

  it.effect("serializes complete extension source transactions across distinct ids", () => {
    const operations: string[] = [];
    let createCalls = 0;
    let configureEntered!: Deferred.Deferred<void>;
    let releaseConfigure!: Deferred.Deferred<void>;
    const configured = {
      extensionId: configureTypescriptApiInput.extensionId,
      enabled: true,
      changed: true,
      reconcileRequired: true,
    } satisfies ConfigureExtensionTypescriptApiResult;

    return Effect.gen(function* () {
      configureEntered = yield* Deferred.make<void>();
      releaseConfigure = yield* Deferred.make<void>();
      const service = yield* RuntimeExtensionLifecycleService;
      const configure = yield* Effect.forkChild(
        service.configureTypescriptApi(configureTypescriptApiInput),
      );
      yield* Deferred.await(configureEntered);
      const create = yield* Effect.forkChild(service.create(createInput));
      yield* Effect.yieldNow;

      assert.strictEqual(createCalls, 0);
      yield* Deferred.succeed(releaseConfigure, undefined);
      assert.deepStrictEqual(yield* Fiber.join(configure), configured);
      assert.deepStrictEqual(yield* Fiber.join(create), createReceipt);
      assert.strictEqual(createCalls, 1);
      assert.deepStrictEqual(operations, [
        "source:configure-typescript-api",
        "runtime:reconcile",
        "log:append",
        "log:publish",
        "source:create",
        "runtime:reconcile",
        "log:append",
        "log:publish",
        `source:finalize:${createMutationId}`,
      ]);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          configureTypescriptApi: () =>
            Effect.gen(function* () {
              operations.push("source:configure-typescript-api");
              yield* Deferred.succeed(configureEntered, undefined);
              yield* Deferred.await(releaseConfigure);
              return configured;
            }),
          createExtension: () =>
            Effect.sync(() => {
              createCalls += 1;
              operations.push("source:create");
              return createReceipt;
            }),
        }),
      ),
    );
  });

  it.effect("preserves the public source-edit operation when TypeScript API mutation fails", () => {
    const operations: string[] = [];
    const sourceFailure = new ExtensionError({
      extensionId: configureTypescriptApiInput.extensionId,
      operation: "extensions.sources.configureTypescriptApi",
      reason: "invalid-input",
      message: "TypeScript API requires an editable svvyx extension.",
    });

    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionLifecycleService;
      const error = yield* service
        .configureTypescriptApi(configureTypescriptApiInput)
        .pipe(Effect.flip);

      assert.instanceOf(error, RuntimeContractError);
      assert.strictEqual(error.operation, "runtime.sourceEdits.configureTypescriptApi");
      assert.strictEqual(error.reason, "schema-error");
      assert.strictEqual(error.cause, sourceFailure);
      assert.deepStrictEqual(operations, ["source:configure-typescript-api"]);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          configureTypescriptApi: () =>
            Effect.suspend(() => {
              operations.push("source:configure-typescript-api");
              return Effect.fail(sourceFailure);
            }),
        }),
      ),
    );
  });

  it.effect("maps a source failure without reconciling or finalizing", () => {
    const operations: string[] = [];
    const sourceFailure = new ExtensionError({
      extensionId: createInput.id,
      operation: "extensions.sources.createExtension",
      reason: "invalid-input",
      message: "Extension source is invalid.",
    });

    return Effect.gen(function* () {
      const service = yield* RuntimeExtensionLifecycleService;
      const error = yield* service.create(createInput).pipe(Effect.flip);

      assert.instanceOf(error, RuntimeContractError);
      assert.strictEqual(error.operation, "runtime.extensions.create");
      assert.strictEqual(error.reason, "schema-error");
      assert.strictEqual(error.message, sourceFailure.message);
      assert.strictEqual(error.cause, sourceFailure);
      assert.deepStrictEqual(operations, ["source:create"]);
    }).pipe(
      Effect.provide(
        testLayer({
          operations,
          createExtension: () =>
            Effect.suspend(() => {
              operations.push("source:create");
              return Effect.fail(sourceFailure);
            }),
        }),
      ),
    );
  });
});

interface TestLayerOptions {
  readonly operations: string[];
  readonly createExtension?: ExtensionsService["sources"]["createExtension"];
  readonly resetExtensionInstructions?: ExtensionsService["sources"]["resetExtensionInstructions"];
  readonly configureTypescriptApi?: ExtensionsService["sources"]["configureTypescriptApi"];
  readonly buildOutcome?: RuntimeExtensionBuildServiceService["buildOutcome"];
}

function testLayer(options: TestLayerOptions) {
  const unused = () => Effect.die("unused lifecycle dependency");
  const extensions = Extensions.of({
    sources: {
      recoverMutations: unused,
      finalizeLifecycleMutation: (mutation: ExtensionSourceMutationId) =>
        Effect.sync(() => {
          options.operations.push(`source:finalize:${mutation}`);
          return { finalized: true };
        }),
      createExtension: options.createExtension ?? unused,
      duplicateExtension: unused,
      deleteExtension: unused,
      resetExtensionInstructions: options.resetExtensionInstructions ?? unused,
      addInstruction: unused,
      removeInstruction: unused,
      configureInstruction: unused,
      renameInstruction: unused,
      reorderInstructions: unused,
      revertMutation: unused,
      configureTypescriptApi: options.configureTypescriptApi ?? unused,
      openEditSession: unused,
      saveEditSession: unused,
      createWorkflowAgent: unused,
      duplicateWorkflowAgent: unused,
      deleteWorkflowAgent: unused,
      scanWorkflowAgents: unused,
      scaffoldMissingWorkflowAgents: unused,
    },
  } as unknown as ExtensionsService);

  return layerRuntimeExtensionLifecycleService.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(Extensions, extensions),
        layerRuntimeExtensionSourceCoordinator,
        Layer.succeed(RuntimeSourceInvalidationService, {
          hint: unused,
          reconcile: () =>
            Effect.sync(() => {
              options.operations.push("runtime:reconcile");
              return {
                changedReadModelCount: 0,
                generatedPackageRefreshes: [],
                recoveryWorkIds: [],
              };
            }),
          applyCommittedScanEvent: unused,
          refreshGeneratedContext: unused,
          refreshGeneratedPackages: unused,
        }),
        Layer.succeed(RuntimeExtensionBuildService, {
          build: unused,
          buildOutcome: options.buildOutcome ?? unused,
        }),
        Layer.succeed(AppLogWritePort, {
          append: () =>
            Effect.sync(() => {
              options.operations.push("log:append");
              return {
                value: { appLogEntryId: "app_log_lifecycle_test" as never },
                afterCommit: [],
              };
            }),
        }),
        Layer.succeed(RuntimeEventBus, {
          publishLive: unused,
          publishStateInvalidations: () =>
            Effect.sync(() => {
              options.operations.push("log:publish");
              return [];
            }),
          subscribe: unused,
        }),
      ),
    ),
  );
}

function mutationId(extensionId: string, hexCharacter: string): ExtensionSourceMutationId {
  return `extension-source-mutation:${extensionId}:${hexCharacter.repeat(
    64,
  )}` as ExtensionSourceMutationId;
}
