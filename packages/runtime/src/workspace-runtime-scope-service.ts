import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { RuntimeContractError, type RuntimeOwnerRef, type WorkspaceId } from "@svvy/core";

type WorkspaceScopeRecord = {
  readonly owners: ReadonlySet<string>;
};

export interface RuntimeWorkspaceScopeServiceService {
  acquire(input: {
    readonly workspaceId: WorkspaceId;
    readonly owner: RuntimeOwnerRef;
  }): Effect.Effect<void, RuntimeContractError>;
  release(input: {
    readonly workspaceId: WorkspaceId;
    readonly owner: RuntimeOwnerRef;
    readonly remainingOwners: number;
    readonly lifecycle: "active" | "idle" | "disposed";
  }): Effect.Effect<void, RuntimeContractError>;
  snapshot(): Effect.Effect<
    ReadonlyArray<{
      readonly workspaceId: WorkspaceId;
      readonly owners: readonly string[];
    }>,
    never
  >;
}

export interface RuntimeWorkspaceScopeService {
  readonly _tag: "RuntimeWorkspaceScopeService";
}

export const RuntimeWorkspaceScopeService = Context.Service<
  RuntimeWorkspaceScopeService,
  RuntimeWorkspaceScopeServiceService
>("@svvy/runtime/RuntimeWorkspaceScopeService");

export function runtimeWorkspaceScopeOwnerKey(owner: RuntimeOwnerRef): string {
  return `${owner.kind}:${owner.ownerId}`;
}

export const makeRuntimeWorkspaceScopeService = Effect.fn(
  "@svvy/runtime/makeRuntimeWorkspaceScopeService",
)(function* () {
  const scopes = yield* Ref.make(new Map<WorkspaceId, WorkspaceScopeRecord>());

  return RuntimeWorkspaceScopeService.of({
    acquire: ({ workspaceId, owner }) =>
      Ref.update(scopes, (current) => {
        const next = new Map(current);
        const record = next.get(workspaceId) ?? { owners: new Set<string>() };
        const owners = new Set(record.owners);
        owners.add(runtimeWorkspaceScopeOwnerKey(owner));
        next.set(workspaceId, { owners });
        return next;
      }).pipe(Effect.mapError((cause) => runtimeWorkspaceScopeError("acquire", cause))),
    release: ({ workspaceId, owner, remainingOwners, lifecycle }) =>
      Ref.update(scopes, (current) => {
        const next = new Map(current);
        const record = next.get(workspaceId);
        if (!record) return next;
        const owners = new Set(record.owners);
        owners.delete(runtimeWorkspaceScopeOwnerKey(owner));
        if (remainingOwners === 0 || lifecycle !== "active" || owners.size === 0) {
          next.delete(workspaceId);
          return next;
        }
        next.set(workspaceId, { owners });
        return next;
      }).pipe(Effect.mapError((cause) => runtimeWorkspaceScopeError("release", cause))),
    snapshot: () =>
      Ref.get(scopes).pipe(
        Effect.map((current) =>
          Array.from(current.entries()).map(([workspaceId, record]) => ({
            workspaceId,
            owners: Array.from(record.owners).toSorted(),
          })),
        ),
      ),
  });
});

export const layerRuntimeWorkspaceScopeService = Layer.effect(
  RuntimeWorkspaceScopeService,
  makeRuntimeWorkspaceScopeService(),
);

function runtimeWorkspaceScopeError(operation: "acquire" | "release", cause: unknown) {
  return new RuntimeContractError({
    operation: `runtime.workspaceScope.${operation}`,
    reason: "state-conflict",
    message:
      cause instanceof Error
        ? cause.message
        : "Runtime workspace scope membership could not be updated.",
    cause,
  });
}
