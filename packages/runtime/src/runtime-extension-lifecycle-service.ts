import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import {
  AppLogWritePort,
  RuntimeContractError,
  type AddExtensionInstructionInput,
  type AddExtensionInstructionResult,
  type BuildRuntimeExtensionInput,
  type ConfigureExtensionInstructionInput,
  type ConfigureExtensionInstructionResult,
  type ConfigureExtensionTypescriptApiInput,
  type ConfigureExtensionTypescriptApiResult,
  type CreateExtensionSourceInput,
  type CreateExtensionSourceResult,
  type DeleteExtensionSourceInput,
  type DeleteExtensionSourceResult,
  type DuplicateExtensionSourceInput,
  type DuplicateExtensionSourceResult,
  type ExtensionError,
  type JsonObject,
  type RemoveExtensionInstructionInput,
  type RemoveExtensionInstructionResult,
  type RenameExtensionInstructionInput,
  type RenameExtensionInstructionResult,
  type ReorderExtensionInstructionsInput,
  type ReorderExtensionInstructionsResult,
  type RevertExtensionSourceMutationInput,
  type RuntimeRevertExtensionSourceMutationResult,
  type ResetExtensionInstructionsInput,
  type RuntimeResetExtensionInstructionsResult,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";

import { RuntimeEventBus } from "./runtime-event-bus";
import { RuntimeExtensionBuildService } from "./runtime-extension-build-service";
import { RuntimeExtensionSourceCoordinator } from "./runtime-extension-source-coordinator";
import { RuntimeSourceInvalidationService } from "./runtime-source-invalidation-service";

export interface RuntimeExtensionLifecycleServiceService {
  create(
    input: CreateExtensionSourceInput,
  ): Effect.Effect<CreateExtensionSourceResult, RuntimeContractError>;
  duplicate(
    input: DuplicateExtensionSourceInput,
  ): Effect.Effect<DuplicateExtensionSourceResult, RuntimeContractError>;
  delete(
    input: DeleteExtensionSourceInput,
  ): Effect.Effect<DeleteExtensionSourceResult, RuntimeContractError>;
  reset(
    input: ResetExtensionInstructionsInput,
  ): Effect.Effect<RuntimeResetExtensionInstructionsResult, RuntimeContractError>;
  addInstruction(
    input: AddExtensionInstructionInput,
  ): Effect.Effect<AddExtensionInstructionResult, RuntimeContractError>;
  removeInstruction(
    input: RemoveExtensionInstructionInput,
  ): Effect.Effect<RemoveExtensionInstructionResult, RuntimeContractError>;
  configureInstruction(
    input: ConfigureExtensionInstructionInput,
  ): Effect.Effect<ConfigureExtensionInstructionResult, RuntimeContractError>;
  configureTypescriptApi(
    input: ConfigureExtensionTypescriptApiInput,
  ): Effect.Effect<ConfigureExtensionTypescriptApiResult, RuntimeContractError>;
  renameInstruction(
    input: RenameExtensionInstructionInput,
  ): Effect.Effect<RenameExtensionInstructionResult, RuntimeContractError>;
  reorderInstructions(
    input: ReorderExtensionInstructionsInput,
  ): Effect.Effect<ReorderExtensionInstructionsResult, RuntimeContractError>;
  revertMutation(
    input: RevertExtensionSourceMutationInput,
  ): Effect.Effect<RuntimeRevertExtensionSourceMutationResult, RuntimeContractError>;
}

export class RuntimeExtensionLifecycleService extends Context.Service<
  RuntimeExtensionLifecycleService,
  RuntimeExtensionLifecycleServiceService
>()("@svvy/runtime/RuntimeExtensionLifecycleService") {}

export const layerRuntimeExtensionLifecycleService = Layer.effect(
  RuntimeExtensionLifecycleService,
  Effect.gen(function* () {
    const extensions = yield* Extensions;
    const sourceInvalidation = yield* RuntimeSourceInvalidationService;
    const extensionBuild = yield* RuntimeExtensionBuildService;
    const appLog = yield* AppLogWritePort;
    const events = yield* RuntimeEventBus;
    const sourceCoordinator = yield* RuntimeExtensionSourceCoordinator;
    const registryLock = yield* Semaphore.make(1);
    const lanes = new Map<string, Semaphore.Semaphore>();

    const laneFor = (extensionId: string) =>
      registryLock.withPermit(
        Effect.gen(function* () {
          const current = lanes.get(extensionId);
          if (current) return current;
          const lane = yield* Semaphore.make(1);
          lanes.set(extensionId, lane);
          return lane;
        }),
      );

    const inLanes = <A, E>(extensionIds: readonly string[], effect: Effect.Effect<A, E>) =>
      sourceCoordinator.serialized(
        Effect.gen(function* () {
          const uniqueIds = [...new Set(extensionIds)].toSorted();
          const selected = yield* Effect.forEach(uniqueIds, laneFor);
          const acquire = (index: number): Effect.Effect<A, E> =>
            index >= selected.length ? effect : selected[index]!.withPermit(acquire(index + 1));
          return yield* acquire(0);
        }),
      );

    const extensionFailure = (operation: string, cause: ExtensionError) =>
      new RuntimeContractError({
        operation,
        reason:
          cause.reason === "not-found"
            ? "target-not-found"
            : cause.reason === "invalid-input" || cause.reason === "unsupported-operation"
              ? "schema-error"
              : "state-conflict",
        message: cause.message,
        cause,
      });

    const reconcileAndLog = (input: { operation: string; message: string; details: JsonObject }) =>
      Effect.gen(function* () {
        yield* sourceInvalidation.reconcile({
          scope: { kind: "app-global" },
          domains: ["extensions"],
          reason: "manual",
        });
        const occurredAt = DateTime.formatIso(yield* DateTime.now) as unknown as Parameters<
          typeof appLog.append
        >[0]["occurredAt"];
        const logged = yield* appLog.append({
          level: "info",
          source: "settings",
          message: input.message,
          occurredAt,
          details: input.details,
        });
        yield* events.publishStateInvalidations({ afterCommit: logged.afterCommit }).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: `${input.operation}.publish-log`,
                reason: "stream-failed",
                message: cause.message,
                cause,
              }),
          ),
        );
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof RuntimeContractError
            ? cause
            : new RuntimeContractError({
                operation: input.operation,
                reason: "state-conflict",
                message: "Extension source committed but runtime reconciliation did not complete.",
                cause,
              }),
        ),
      );

    const create = (input: CreateExtensionSourceInput) =>
      inLanes(
        [input.id],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .createExtension(input)
            .pipe(Effect.mapError((cause) => extensionFailure("runtime.extensions.create", cause)));
          yield* reconcileAndLog({
            operation: "runtime.extensions.create",
            message: "Extension source created.",
            details: { extensionId: result.extensionId, mutationId: result.mutationId },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(result.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.create.finalize", cause),
              ),
            );
          return result;
        }),
      );

    const duplicate = (input: DuplicateExtensionSourceInput) =>
      inLanes(
        [input.sourceExtensionId, input.targetExtensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .duplicateExtension(input)
            .pipe(
              Effect.mapError((cause) => extensionFailure("runtime.extensions.duplicate", cause)),
            );
          yield* reconcileAndLog({
            operation: "runtime.extensions.duplicate",
            message: "Extension source duplicated.",
            details: {
              extensionId: result.extensionId,
              sourceExtensionId: result.sourceExtensionId,
              mutationId: result.mutationId,
            },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(result.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.duplicate.finalize", cause),
              ),
            );
          return result;
        }),
      );

    const remove = (input: DeleteExtensionSourceInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .deleteExtension(input)
            .pipe(Effect.mapError((cause) => extensionFailure("runtime.extensions.delete", cause)));
          yield* reconcileAndLog({
            operation: "runtime.extensions.delete",
            message: "Extension source deleted.",
            details: { extensionId: result.extensionId, mutationId: result.mutationId },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(result.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.delete.finalize", cause),
              ),
            );
          return result;
        }),
      );

    const reset = (input: ResetExtensionInstructionsInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const source = yield* extensions.sources
            .resetExtensionInstructions(input)
            .pipe(Effect.mapError((cause) => extensionFailure("runtime.extensions.reset", cause)));
          if (!source.changed) {
            return {
              source,
              automaticBuild: { status: "skipped", reason: "source-unchanged" },
            } satisfies RuntimeResetExtensionInstructionsResult;
          }
          yield* reconcileAndLog({
            operation: "runtime.extensions.reset",
            message: "Builtin extension instructions reset.",
            details: { extensionId: source.extensionId, mutationId: source.mutationId },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(source.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.reset.finalize", cause),
              ),
            );
          const buildOutcome = yield* extensionBuild.buildOutcome({
            extensionId: input.extensionId,
            clientRequestId:
              `extension-build:${source.mutationId}` as BuildRuntimeExtensionInput["clientRequestId"],
          });
          return buildOutcome.status === "succeeded"
            ? ({
                source,
                automaticBuild: {
                  status: "succeeded",
                  attemptId: buildOutcome.result.attemptId,
                },
              } satisfies RuntimeResetExtensionInstructionsResult)
            : ({
                source,
                automaticBuild:
                  buildOutcome.status === "failed"
                    ? {
                        status: "failed",
                        attemptId: buildOutcome.attemptId,
                        failureReason: buildOutcome.failureReason,
                      }
                    : {
                        status: "not-started",
                        failureReason: buildOutcome.failureReason,
                      },
              } satisfies RuntimeResetExtensionInstructionsResult);
        }),
      );

    const addInstruction = (input: AddExtensionInstructionInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .addInstruction(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.addInstruction", cause),
              ),
            );
          yield* reconcileAndLog({
            operation: "runtime.extensions.addInstruction",
            message: "Extension instruction source added.",
            details: {
              extensionId: result.extensionId,
              name: result.name,
              mutationId: result.mutationId,
            },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(result.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.addInstruction.finalize", cause),
              ),
            );
          return result;
        }),
      );

    const removeInstruction = (input: RemoveExtensionInstructionInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .removeInstruction(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.removeInstruction", cause),
              ),
            );
          yield* reconcileAndLog({
            operation: "runtime.extensions.removeInstruction",
            message: "Extension instruction source removed.",
            details: {
              extensionId: result.extensionId,
              name: result.name,
              mutationId: result.mutationId,
            },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(result.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.removeInstruction.finalize", cause),
              ),
            );
          return result;
        }),
      );

    const configureInstruction = (input: ConfigureExtensionInstructionInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .configureInstruction(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.configureInstruction", cause),
              ),
            );
          if (result.changed) {
            yield* reconcileAndLog({
              operation: "runtime.extensions.configureInstruction",
              message: "Extension instruction source configured.",
              details: {
                extensionId: result.extensionId,
                name: result.name,
                bypassed: result.bypassed,
                mutationId: result.mutationId,
              },
            });
            yield* extensions.sources
              .finalizeLifecycleMutation(result.mutationId)
              .pipe(
                Effect.mapError((cause) =>
                  extensionFailure("runtime.extensions.configureInstruction.finalize", cause),
                ),
              );
          }
          return result;
        }),
      );

    const configureTypescriptApi = (input: ConfigureExtensionTypescriptApiInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .configureTypescriptApi(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.sourceEdits.configureTypescriptApi", cause),
              ),
            );
          if (result.reconcileRequired) {
            yield* sourceInvalidation.reconcile({
              scope: { kind: "app-global" },
              domains: ["extensions"],
              reason: "manual",
            });
          }
          yield* Effect.gen(function* () {
            const occurredAt = DateTime.formatIso(yield* DateTime.now) as unknown as Parameters<
              typeof appLog.append
            >[0]["occurredAt"];
            const logged = yield* appLog.append({
              level: "info",
              source: "settings",
              message: "Extension TypeScript API setting updated.",
              occurredAt,
              details: {
                workspaceId: input.workspaceId,
                extensionId: input.extensionId,
                enabled: input.enabled,
                changed: result.changed,
              },
            });
            yield* events.publishStateInvalidations({ afterCommit: logged.afterCommit });
          }).pipe(Effect.ignore);
          return result;
        }),
      );

    const renameInstruction = (input: RenameExtensionInstructionInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .renameInstruction(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.renameInstruction", cause),
              ),
            );
          yield* reconcileAndLog({
            operation: "runtime.extensions.renameInstruction",
            message: "Extension instruction source renamed.",
            details: {
              extensionId: result.extensionId,
              from: result.from,
              to: result.to,
              mutationId: result.mutationId,
            },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(result.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.renameInstruction.finalize", cause),
              ),
            );
          return result;
        }),
      );

    const reorderInstructions = (input: ReorderExtensionInstructionsInput) =>
      inLanes(
        [input.extensionId],
        Effect.gen(function* () {
          const result = yield* extensions.sources
            .reorderInstructions(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.reorderInstructions", cause),
              ),
            );
          if (result.changed) {
            yield* reconcileAndLog({
              operation: "runtime.extensions.reorderInstructions",
              message: "Extension instruction sources reordered.",
              details: { extensionId: result.extensionId, mutationId: result.mutationId },
            });
            yield* extensions.sources
              .finalizeLifecycleMutation(result.mutationId)
              .pipe(
                Effect.mapError((cause) =>
                  extensionFailure("runtime.extensions.reorderInstructions.finalize", cause),
                ),
              );
          }
          return result;
        }),
      );

    const revertMutation = (input: RevertExtensionSourceMutationInput) => {
      const extensionId = input.mutationId.split(":")[1]!;
      return inLanes(
        [extensionId],
        Effect.gen(function* () {
          const source = yield* extensions.sources
            .revertMutation(input)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.revertMutation", cause),
              ),
            );
          yield* reconcileAndLog({
            operation: "runtime.extensions.revertMutation",
            message: "Extension source lifecycle mutation reverted.",
            details: {
              extensionId: source.extensionId,
              mutationId: source.mutationId,
              revertedMutationId: source.revertedMutationId,
            },
          });
          yield* extensions.sources
            .finalizeLifecycleMutation(source.mutationId)
            .pipe(
              Effect.mapError((cause) =>
                extensionFailure("runtime.extensions.revertMutation.finalize", cause),
              ),
            );
          const buildOutcome = yield* extensionBuild.buildOutcome({
            extensionId: source.extensionId,
            clientRequestId:
              `extension-build:${source.mutationId}` as BuildRuntimeExtensionInput["clientRequestId"],
          });
          return {
            source,
            automaticBuild:
              buildOutcome.status === "succeeded"
                ? { status: "succeeded", attemptId: buildOutcome.result.attemptId }
                : buildOutcome.status === "failed"
                  ? {
                      status: "failed",
                      attemptId: buildOutcome.attemptId,
                      failureReason: buildOutcome.failureReason,
                    }
                  : { status: "not-started", failureReason: buildOutcome.failureReason },
          } satisfies RuntimeRevertExtensionSourceMutationResult;
        }),
      );
    };

    return RuntimeExtensionLifecycleService.of({
      create,
      duplicate,
      delete: remove,
      reset,
      addInstruction,
      removeInstruction,
      configureInstruction,
      configureTypescriptApi,
      renameInstruction,
      reorderInstructions,
      revertMutation,
    });
  }),
);
