import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeContractError,
  type ApplyCommittedSourceInvalidationEventInput,
  type GeneratedPackagesRefreshResult,
  type RefreshGeneratedContextRequest,
  type InternalRefreshGeneratedPackagesRequest,
  type SourceInvalidationHint,
  type SourceReconcileRequest,
  type SourceReconcileResult,
  type WorkspaceId,
} from "@svvy/core";
import { RuntimeGeneratedContextRefreshService } from "./runtime-generated-context-refresh-service";
import { RuntimeGeneratedPackageRefreshService } from "./runtime-generated-package-refresh-service";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  reactToRuntimeSourceInvalidationEvent,
  type RuntimeSourceInvalidationReactionInput,
} from "./source-invalidation-reactions";
import type {
  SourceInvalidationEvent,
  SourceInvalidationHintClassification,
} from "./source-invalidation-coordinator";

export interface RuntimeSourceInvalidationScanPortService {
  classifyHint(
    input: SourceInvalidationHint,
  ): Effect.Effect<SourceInvalidationHintClassification, RuntimeContractError>;
  listAcquiredWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  requestScan(input: SourceReconcileRequest): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceInvalidationEvent | null, RuntimeContractError>;
}

export interface RuntimeSourceInvalidationScanPort {
  readonly _tag: "RuntimeSourceInvalidationScanPort";
}

export const RuntimeSourceInvalidationScanPort = Context.Service<
  RuntimeSourceInvalidationScanPort,
  RuntimeSourceInvalidationScanPortService
>("@svvy/runtime/RuntimeSourceInvalidationScanPort");

export interface RuntimeSourceInvalidationServiceService {
  hint(input: SourceInvalidationHint): Effect.Effect<void, RuntimeContractError>;
  reconcile(
    input: SourceReconcileRequest,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  applyCommittedScanEvent(
    input: ApplyCommittedSourceInvalidationEventInput,
  ): Effect.Effect<SourceReconcileResult, RuntimeContractError>;
  refreshGeneratedContext(
    input: RefreshGeneratedContextRequest,
  ): Effect.Effect<void, RuntimeContractError>;
  refreshGeneratedPackages(
    input: InternalRefreshGeneratedPackagesRequest,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
}

export class RuntimeSourceInvalidationService extends Context.Service<
  RuntimeSourceInvalidationService,
  RuntimeSourceInvalidationServiceService
>()("@svvy/runtime/RuntimeSourceInvalidationService") {}

export const layerRuntimeSourceInvalidationService = Layer.effect(
  RuntimeSourceInvalidationService,
  Effect.gen(function* () {
    const generatedContextRefresh = yield* RuntimeGeneratedContextRefreshService;
    const generatedPackageRefresh = yield* RuntimeGeneratedPackageRefreshService;
    const sourceScanner = yield* RuntimeSourceInvalidationScanPort;
    const eventBus = yield* RuntimeEventBus;

    const reactToScan = (input: RuntimeSourceInvalidationReactionInput) =>
      reactToRuntimeSourceInvalidationEvent(input, {
        listAcquiredWorkspaceIds: () => sourceScanner.listAcquiredWorkspaceIds(),
        refreshGeneratedContext: (request) => generatedContextRefresh.refresh(request),
        refreshGeneratedPackages: (request) => generatedPackageRefresh.refresh(request),
      });

    const applyCommittedScanEvent = (input: ApplyCommittedSourceInvalidationEventInput) =>
      Effect.gen(function* () {
        const event: SourceInvalidationEvent = input.event;
        yield* eventBus.publishStateInvalidations({ afterCommit: event.afterCommit }).pipe(
          Effect.mapError(
            (cause) =>
              new RuntimeContractError({
                operation: "runtime.sourceInvalidation.applyCommittedScanEvent.publish",
                reason: "state-conflict",
                message:
                  cause instanceof Error
                    ? cause.message
                    : "Runtime source invalidation publication failed.",
                cause,
              }),
          ),
          Effect.asVoid,
        );
        const reaction =
          input.scope.kind === "app-global"
            ? yield* reactToScan({ scope: { kind: "app-global" }, event })
            : yield* reactToScan({ scope: input.scope, event });
        const generatedPackageRefreshes = reaction.generatedPackageRefresh
          ? [reaction.generatedPackageRefresh]
          : [];
        return {
          changedReadModelCount: event.afterCommit.length,
          generatedPackageRefreshes,
          recoveryWorkIds: generatedPackageRefreshes.flatMap((refresh) => refresh.recoveryWorkIds),
        } satisfies SourceReconcileResult;
      });

    const reconcileSourceInputs = (input: SourceReconcileRequest) =>
      Effect.gen(function* () {
        const event = yield* sourceScanner.reconcile(input);
        if (!event) {
          return {
            changedReadModelCount: 0,
            generatedPackageRefreshes: [],
            recoveryWorkIds: [],
          } satisfies SourceReconcileResult;
        }
        return yield* applyCommittedScanEvent({ scope: input.scope, event });
      });

    return RuntimeSourceInvalidationService.of({
      hint: (input) =>
        Effect.gen(function* () {
          const classification = yield* sourceScanner.classifyHint(input);
          if (classification === "ignore") {
            return;
          }
          yield* sourceScanner.requestScan({
            scope: input.scope,
            domains: [input.domain],
            reason:
              classification === "scan-parent-domain"
                ? "ignored-path-parent-domain-scan"
                : "watcher-debounce",
          });
        }),
      reconcile: reconcileSourceInputs,
      applyCommittedScanEvent,
      refreshGeneratedContext: (input) => generatedContextRefresh.refresh(input),
      refreshGeneratedPackages: (input) => generatedPackageRefresh.refresh(input),
    });
  }),
);
