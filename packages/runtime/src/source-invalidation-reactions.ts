import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  type GeneratedPackagesRefreshResult,
  type RefreshGeneratedContextRequest,
  type RefreshGeneratedPackagesRequest,
  type WorkspaceId,
} from "@svvy/core";
import {
  generatedContextReasonForRuntimeSourceInvalidation,
  generatedPackagesForRuntimeSourceInvalidation,
} from "./generated-package-refresh";
import type { SourceInvalidationEvent } from "./source-invalidation-coordinator";

export type RuntimeSourceInvalidationReactionInput =
  | {
      readonly scope: { readonly kind: "app-global" };
      readonly event: SourceInvalidationEvent;
    }
  | {
      readonly scope: { readonly kind: "workspace"; readonly workspaceId: WorkspaceId };
      readonly event: SourceInvalidationEvent;
    };

export interface RuntimeSourceInvalidationReactionHost {
  listAcquiredWorkspaceIds(): Effect.Effect<readonly WorkspaceId[], RuntimeContractError>;
  refreshGeneratedContext(
    input: Extract<RefreshGeneratedContextRequest, { scope: "workspace" }>,
  ): Effect.Effect<void, RuntimeContractError>;
  refreshGeneratedPackages(
    input: Extract<RefreshGeneratedPackagesRequest, { scope: "app-global" }>,
  ): Effect.Effect<GeneratedPackagesRefreshResult, RuntimeContractError>;
}

export interface RuntimeSourceInvalidationReactionResult {
  readonly generatedPackageRefresh: GeneratedPackagesRefreshResult | null;
  readonly refreshedGeneratedContextWorkspaces: readonly WorkspaceId[];
}

export function reactToRuntimeSourceInvalidationEvent(
  input: RuntimeSourceInvalidationReactionInput,
  host: RuntimeSourceInvalidationReactionHost,
): Effect.Effect<RuntimeSourceInvalidationReactionResult, RuntimeContractError> {
  return Effect.gen(function* () {
    const generatedPackageRefresh =
      input.scope.kind === "app-global"
        ? yield* refreshAppGlobalGeneratedPackages(input.event, host)
        : null;
    const refreshedGeneratedContextWorkspaces = yield* refreshGeneratedContextForSourceChange(
      input,
      host,
    );
    return {
      generatedPackageRefresh,
      refreshedGeneratedContextWorkspaces,
    } satisfies RuntimeSourceInvalidationReactionResult;
  });
}

function refreshAppGlobalGeneratedPackages(
  event: SourceInvalidationEvent,
  host: RuntimeSourceInvalidationReactionHost,
): Effect.Effect<GeneratedPackagesRefreshResult | null, RuntimeContractError> {
  const packages = generatedPackagesForRuntimeSourceInvalidation(event.domains);
  if (packages.length === 0) {
    return Effect.succeed(null);
  }
  return host.refreshGeneratedPackages({
    scope: "app-global",
    packages,
    reason: "source-changed",
  });
}

function refreshGeneratedContextForSourceChange(
  input: RuntimeSourceInvalidationReactionInput,
  host: RuntimeSourceInvalidationReactionHost,
): Effect.Effect<readonly WorkspaceId[], RuntimeContractError> {
  const reason = generatedContextReasonForRuntimeSourceInvalidation(input.event.domains);
  if (!reason) {
    return Effect.succeed([]);
  }
  return Effect.gen(function* () {
    const workspaceIds =
      input.scope.kind === "workspace"
        ? [input.scope.workspaceId]
        : yield* host.listAcquiredWorkspaceIds();
    yield* Effect.forEach(
      workspaceIds,
      (workspaceId) =>
        host.refreshGeneratedContext({
          scope: "workspace",
          workspaceId,
          reason,
        }),
      { concurrency: "unbounded", discard: true },
    );
    return workspaceIds;
  });
}
