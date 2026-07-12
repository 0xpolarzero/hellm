import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import {
  type PiAdapterError,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  type PiRuntimeEvent,
  ProviderAuthPort,
  RuntimeContractError,
  type ActorKind,
  type CreatePiSessionInput,
  type OpenPiSessionInput,
  type PiSessionRef,
  type RuntimeSurfaceTarget,
  type RunPiTurnInput,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import { PiAdapter } from "@svvy/pi-adapter";

export interface RuntimePiTurnStream {
  readonly stream: Stream.Stream<PiRuntimeEvent, PiAdapterError>;
  close(): Effect.Effect<void, PiAdapterError>;
  readonly closed: Effect.Effect<void, PiAdapterError>;
}

export type RuntimeSurfacePromptInterruptReason =
  | "user-abort"
  | "surface-close"
  | "runtime-shutdown"
  | "recovery-cancel";

export interface RuntimeSurfaceRuntimeServiceService {
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly session: PiSessionRef;
  withPromptLock<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
  acquirePromptLock(): Effect.Effect<Effect.Effect<void>>;
  restorePiHistory(input: {
    readonly entryId: import("@svvy/core").PiHistoryEntryRef;
  }): Effect.Effect<void, RuntimeContractError>;
  runPiTurn(input: RunPiTurnInput): Effect.Effect<RuntimePiTurnStream, RuntimeContractError>;
  interruptActivePrompt(input: {
    readonly turnId?: string | null;
    readonly reason: RuntimeSurfacePromptInterruptReason;
    readonly force?: boolean;
  }): Effect.Effect<void, RuntimeContractError>;
  isPromptActive(): boolean;
  activePromptDone(): Effect.Effect<void, RuntimeContractError> | null;
  installActivePrompt(input: {
    readonly turnId: string;
    readonly fiber: Fiber.Fiber<void, RuntimeContractError>;
  }): Effect.Effect<void>;
  clearActivePrompt(input: { readonly turnId: string }): Effect.Effect<void>;
}

export class RuntimeSurfaceRuntimeService extends Context.Service<
  RuntimeSurfaceRuntimeService,
  RuntimeSurfaceRuntimeServiceService
>()("@svvy/runtime/RuntimeSurfaceRuntimeService") {}

export interface RuntimeSurfaceScopeServiceService {
  create(
    input: CreatePiSessionInput,
  ): Effect.Effect<RuntimeSurfaceRuntimeServiceService, RuntimeContractError>;
  open(
    input: OpenPiSessionInput,
  ): Effect.Effect<RuntimeSurfaceRuntimeServiceService, RuntimeContractError>;
  retainOpen(input: {
    readonly workspaceId: WorkspaceId;
    readonly target: RuntimeSurfaceTarget;
  }): Effect.Effect<RuntimeSurfaceRuntimeServiceService, RuntimeContractError>;
  release(input: { readonly surfacePiSessionId: SurfacePiSessionId }): Effect.Effect<void>;
  interrupt(input: {
    readonly surfacePiSessionId: SurfacePiSessionId;
    readonly turnId?: string | null;
    readonly reason: RuntimeSurfacePromptInterruptReason;
    readonly force?: boolean;
  }): Effect.Effect<void, RuntimeContractError>;
  snapshot(): Effect.Effect<readonly SurfaceScopeSnapshotEntry[]>;
}

export type SurfaceScopeSnapshotEntry = {
  readonly surfacePiSessionId: SurfacePiSessionId;
  readonly retainCount: number;
  readonly activeTurnId: string | null;
};

export class RuntimeSurfaceScopeService extends Context.Service<
  RuntimeSurfaceScopeService,
  RuntimeSurfaceScopeServiceService
>()("@svvy/runtime/RuntimeSurfaceScopeService") {}

type SurfaceEntry = {
  readonly service: RuntimeSurfaceRuntimeServiceService;
  readonly scope: Scope.Closeable;
  readonly actorKind: ActorKind;
  readonly workspaceId: WorkspaceId;
  readonly retainCount: number;
  readonly activeTurnId: string | null;
  readonly activePromptFiber: Fiber.Fiber<void, RuntimeContractError> | null;
};

export const layerRuntimeSurfaceScopeService = Layer.effect(
  RuntimeSurfaceScopeService,
  Effect.gen(function* () {
    const adapter = yield* PiAdapter;
    const providerAuth = yield* ProviderAuthPort;
    const runtimePaths = yield* PiRuntimePathsPort;
    const references = yield* PiSessionReferencePort;
    const entries = yield* Ref.make(new Map<SurfacePiSessionId, SurfaceEntry>());
    const closing = new Map<SurfacePiSessionId, Deferred.Deferred<void>>();
    let closeUnusedSurface: (input: {
      readonly surfacePiSessionId: SurfacePiSessionId;
    }) => Effect.Effect<void> = () => Effect.void;

    const makeRuntimeSurface = (input: {
      readonly session: PiSessionRef;
      readonly scope: Scope.Closeable;
    }): Effect.Effect<RuntimeSurfaceRuntimeServiceService> =>
      Effect.gen(function* () {
        const promptLock = yield* Semaphore.make(1);
        let activeTurnId: string | null = null;
        let activePromptFiber: Fiber.Fiber<void, RuntimeContractError> | null = null;

        const service: RuntimeSurfaceRuntimeServiceService = RuntimeSurfaceRuntimeService.of({
          surfacePiSessionId: input.session.surfacePiSessionId,
          session: input.session,
          withPromptLock: (effect) => promptLock.withPermit(effect),
          acquirePromptLock: () =>
            Effect.gen(function* () {
              const acquired = yield* Deferred.make<void>();
              const release = yield* Deferred.make<void>();
              yield* promptLock
                .withPermit(
                  Deferred.succeed(acquired, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                  ),
                )
                .pipe(Effect.forkIn(input.scope));
              yield* Deferred.await(acquired);
              return Deferred.succeed(release, undefined).pipe(Effect.asVoid);
            }),
          restorePiHistory: ({ entryId }) =>
            adapter.history.restoreToEntry({ session: input.session, entryId }).pipe(
              Effect.provideService(PiSessionReferencePort, references),
              Effect.mapError((cause) =>
                runtimePiAdapterError("runtime.surface.restorePiHistory", cause),
              ),
            ),
          runPiTurn: (turnInput) =>
            adapter.turns.run(turnInput).pipe(
              Effect.provideService(Scope.Scope, input.scope),
              Effect.provideService(ProviderAuthPort, providerAuth),
              Effect.provideService(PiSessionReferencePort, references),
              Effect.mapError((cause) => runtimePiAdapterError("runtime.surface.runPiTurn", cause)),
            ),
          interruptActivePrompt: ({ turnId, force }) =>
            Effect.gen(function* () {
              const entry = yield* Ref.get(entries).pipe(
                Effect.map((current) => current.get(input.session.surfacePiSessionId)),
              );
              const resolvedTurnId = turnId ?? entry?.activeTurnId;
              if (!resolvedTurnId) {
                return;
              }
              const interruptAdapter = adapter.turns
                .interrupt({
                  surfacePiSessionId: input.session.surfacePiSessionId,
                  turnId: resolvedTurnId as never,
                })
                .pipe(
                  Effect.provideService(PiSessionReferencePort, references),
                  Effect.catchTag("PiAdapterError", () => Effect.void),
                  Effect.mapError((cause) =>
                    runtimePiAdapterError("runtime.surface.interruptActivePrompt", cause),
                  ),
                );
              if (!force) {
                yield* interruptAdapter;
                return;
              }
              yield* interruptAdapter;
              if (activePromptFiber) {
                yield* Fiber.interrupt(activePromptFiber).pipe(Effect.asVoid);
              }
            }),
          isPromptActive: () => activeTurnId !== null,
          activePromptDone: () => (activePromptFiber ? Fiber.join(activePromptFiber) : null),
          installActivePrompt: ({ turnId, fiber }) =>
            Effect.sync(() => {
              activeTurnId = turnId;
              activePromptFiber = fiber;
            }).pipe(
              Effect.andThen(
                Ref.update(entries, (current) => {
                  const next = new Map(current);
                  const existing = next.get(input.session.surfacePiSessionId);
                  if (!existing) return current;
                  next.set(input.session.surfacePiSessionId, {
                    ...existing,
                    activeTurnId: turnId,
                    activePromptFiber: fiber,
                  });
                  return next;
                }),
              ),
            ),
          clearActivePrompt: ({ turnId }) =>
            Effect.sync(() => {
              if (activeTurnId === turnId) {
                activeTurnId = null;
                activePromptFiber = null;
              }
            }).pipe(
              Effect.andThen(
                Ref.update(entries, (current) => {
                  const next = new Map(current);
                  const existing = next.get(input.session.surfacePiSessionId);
                  if (!existing || existing.activeTurnId !== turnId) return current;
                  next.set(input.session.surfacePiSessionId, {
                    ...existing,
                    activeTurnId: null,
                    activePromptFiber: null,
                  });
                  return next;
                }),
              ),
              Effect.andThen(
                closeUnusedSurface({
                  surfacePiSessionId: input.session.surfacePiSessionId,
                }),
              ),
            ),
        });
        return service;
      });

    const retainExisting = (surfacePiSessionId: SurfacePiSessionId) =>
      Ref.modify(entries, (current) => {
        const existing = current.get(surfacePiSessionId);
        if (!existing) return [null, current] as const;
        const next = new Map(current);
        next.set(surfacePiSessionId, {
          ...existing,
          retainCount: existing.retainCount + 1,
        });
        return [existing.service, next] as const;
      });

    const register = (input: {
      readonly workspaceId: WorkspaceId;
      readonly actorKind: ActorKind;
      readonly session: PiSessionRef;
      readonly scope: Scope.Closeable;
    }) =>
      Effect.gen(function* () {
        const service = yield* makeRuntimeSurface(input);
        yield* Ref.update(entries, (current) => {
          const next = new Map(current);
          next.set(input.session.surfacePiSessionId, {
            service,
            scope: input.scope,
            actorKind: input.actorKind,
            workspaceId: input.workspaceId,
            retainCount: 1,
            activeTurnId: null,
            activePromptFiber: null,
          });
          return next;
        });
        return service;
      });

    const openWith = (input: {
      readonly surfacePiSessionId: SurfacePiSessionId;
      readonly workspaceId: WorkspaceId;
      readonly actorKind: ActorKind;
      readonly open: (scope: Scope.Closeable) => Effect.Effect<PiSessionRef, unknown>;
    }) =>
      Effect.gen(function* () {
        const closingPromise = closing.get(input.surfacePiSessionId);
        if (closingPromise) {
          yield* Deferred.await(closingPromise);
        }
        const existing = yield* retainExisting(input.surfacePiSessionId);
        if (existing) return existing;
        const scope = yield* Scope.make("sequential");
        const session = yield* input
          .open(scope)
          .pipe(
            Effect.catch((cause: unknown) =>
              Scope.close(scope, Exit.void).pipe(
                Effect.andThen(
                  Effect.fail(runtimePiAdapterError("runtime.surface.acquire", cause)),
                ),
              ),
            ),
          );
        return yield* register({
          workspaceId: input.workspaceId,
          actorKind: input.actorKind,
          session,
          scope,
        });
      });

    const closeReleasedEntry = (released: SurfaceEntry): Effect.Effect<void> =>
      Effect.gen(function* () {
        const surfacePiSessionId = released.service.surfacePiSessionId;
        const closingDeferred = yield* Deferred.make<void>();
        closing.set(surfacePiSessionId, closingDeferred);
        yield* adapter.sessions.close({ session: released.service.session }).pipe(
          Effect.ignore,
          Effect.andThen(Scope.close(released.scope, Exit.void).pipe(Effect.ignore)),
          Effect.ensuring(
            Effect.sync(() => {
              closing.delete(surfacePiSessionId);
            }).pipe(Effect.andThen(Deferred.succeed(closingDeferred, undefined))),
          ),
        );
      });

    closeUnusedSurface = ({ surfacePiSessionId }) =>
      Effect.gen(function* () {
        const released = yield* Ref.modify(entries, (current) => {
          const existing = current.get(surfacePiSessionId);
          if (!existing || existing.retainCount > 0 || existing.activeTurnId) {
            return [null, current] as const;
          }
          const next = new Map(current);
          next.delete(surfacePiSessionId);
          return [existing, next] as const;
        });
        if (released) {
          yield* closeReleasedEntry(released);
        }
      });

    const closeRemainingEntry = (entry: SurfaceEntry): Effect.Effect<void> =>
      entry.service
        .interruptActivePrompt({
          turnId: entry.activeTurnId,
          reason: "runtime-shutdown",
          force: true,
        })
        .pipe(
          Effect.catch(() => Effect.void),
          Effect.andThen(
            adapter.sessions
              .close({ session: entry.service.session })
              .pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.andThen(Scope.close(entry.scope, Exit.void).pipe(Effect.catch(() => Effect.void))),
        );
    const closeRemainingSurfaces: Effect.Effect<void> = Effect.gen(function* () {
      const remaining = yield* Ref.getAndSet(entries, new Map());
      yield* Effect.forEach(Array.from(remaining.values()), closeRemainingEntry, { discard: true });
    }).pipe(Effect.catchCause(() => Effect.void));
    yield* Effect.addFinalizer(() => closeRemainingSurfaces);

    return RuntimeSurfaceScopeService.of({
      create: (input) =>
        openWith({
          surfacePiSessionId: input.surfacePiSessionId,
          workspaceId: input.workspaceId,
          actorKind: input.actorKind,
          open: (scope) =>
            adapter.sessions
              .create(input)
              .pipe(
                Effect.provideService(Scope.Scope, scope),
                Effect.provideService(ProviderAuthPort, providerAuth),
                Effect.provideService(PiRuntimePathsPort, runtimePaths),
                Effect.provideService(PiSessionReferencePort, references),
              ),
        }),
      open: (input) =>
        openWith({
          surfacePiSessionId: input.surfacePiSessionId,
          workspaceId: input.workspaceId,
          actorKind: input.actorKind,
          open: (scope) =>
            adapter.sessions
              .open(input)
              .pipe(
                Effect.provideService(Scope.Scope, scope),
                Effect.provideService(ProviderAuthPort, providerAuth),
                Effect.provideService(PiRuntimePathsPort, runtimePaths),
                Effect.provideService(PiSessionReferencePort, references),
              ),
        }),
      retainOpen: ({ workspaceId, target }) =>
        openWith({
          surfacePiSessionId: target.surfacePiSessionId,
          workspaceId,
          actorKind: target.surface,
          open: (scope) =>
            adapter.sessions
              .open({
                workspaceId,
                surfacePiSessionId: target.surfacePiSessionId,
                actorKind: target.surface,
              })
              .pipe(
                Effect.provideService(Scope.Scope, scope),
                Effect.provideService(ProviderAuthPort, providerAuth),
                Effect.provideService(PiRuntimePathsPort, runtimePaths),
                Effect.provideService(PiSessionReferencePort, references),
              ),
        }),
      release: ({ surfacePiSessionId }) =>
        Effect.gen(function* () {
          const released = yield* Ref.modify(entries, (current) => {
            const existing = current.get(surfacePiSessionId);
            if (!existing) return [null, current] as const;
            if (existing.retainCount > 1 || existing.activeTurnId) {
              const next = new Map(current);
              next.set(surfacePiSessionId, {
                ...existing,
                retainCount: Math.max(0, existing.retainCount - 1),
              });
              return [null, next] as const;
            }
            const next = new Map(current);
            next.delete(surfacePiSessionId);
            return [existing, next] as const;
          });
          if (!released) return;
          yield* closeReleasedEntry(released);
        }),
      interrupt: ({ surfacePiSessionId, turnId, reason, force }) =>
        Effect.gen(function* () {
          const entry = yield* Ref.get(entries).pipe(
            Effect.map((current) => current.get(surfacePiSessionId)),
          );
          if (!entry) return;
          yield* entry.service.interruptActivePrompt({
            ...(turnId === undefined ? {} : { turnId }),
            reason,
            ...(force === undefined ? {} : { force }),
          });
        }),
      snapshot: () =>
        Ref.get(entries).pipe(
          Effect.map((current) =>
            Array.from(current.values()).map((entry) => ({
              surfacePiSessionId: entry.service.surfacePiSessionId,
              retainCount: entry.retainCount,
              activeTurnId: entry.activeTurnId,
            })),
          ),
        ),
    });
  }),
);

function runtimePiAdapterError(operation: string, cause: unknown): RuntimeContractError {
  if (cause instanceof RuntimeContractError) {
    return cause;
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new RuntimeContractError({
    operation,
    reason: "target-not-ready",
    message,
    cause,
  });
}
