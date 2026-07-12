import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import {
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  type AbsolutePath,
  type SurfacePiSessionId,
  type WorkspaceId,
} from "@svvy/core";
import { PiAdapter } from "@svvy/pi-adapter";
import {
  layerRuntimeSurfaceScopeService,
  RuntimeSurfaceScopeService,
} from "./surface-runtime-scope-service";

const workspaceId = "workspace_surface_scope" as WorkspaceId;
const surfacePiSessionId = "pi_surface_scope" as SurfacePiSessionId;

function surfaceScopeDependencies(
  options: {
    readonly onOpen?: (surfacePiSessionId: SurfacePiSessionId) => void;
    readonly close?: () => Effect.Effect<void>;
    readonly interrupt?: () => Effect.Effect<void>;
  } = {},
) {
  return Layer.mergeAll(
    Layer.succeed(PiAdapter, {
      sessions: {
        create: () => Effect.die("unused"),
        open: (input) =>
          Effect.sync(() => {
            options.onOpen?.(input.surfacePiSessionId);
            return { surfacePiSessionId: input.surfacePiSessionId };
          }),
        close: () => options.close?.() ?? Effect.void,
        rename: () => Effect.die("unused"),
        fork: () => Effect.die("unused"),
        delete: () => Effect.die("unused"),
      },
      turns: {
        run: () =>
          Effect.succeed({
            stream: Stream.empty,
            close: () => Effect.void,
            closed: Effect.void,
          }),
        interrupt: () => options.interrupt?.() ?? Effect.void,
      },
      history: { restoreToEntry: () => Effect.die("unused") },
      models: { list: () => Effect.succeed([]) },
      helperJobs: { generateTitle: () => Effect.die("unused") },
    }),
    Layer.succeed(ProviderAuthPort, {
      getProviderAuthSnapshot: () =>
        Effect.succeed({ providerId: "openai" as never, health: "missing" as const }),
      refreshProviderCredentialSnapshot: () =>
        Effect.succeed({ providerId: "openai" as never, health: "missing" as const }),
    }),
    Layer.succeed(PiRuntimePathsPort, {
      resolve: () =>
        Effect.succeed({
          workspaceId,
          cwd: "/tmp/svvy-surface-scope" as AbsolutePath,
          agentDir: "/tmp/svvy-surface-scope/agent" as AbsolutePath,
          sessionDir: "/tmp/svvy-surface-scope/sessions" as AbsolutePath,
          modelRegistryPath: "/tmp/svvy-surface-scope/model-registry.json" as AbsolutePath,
          source: "test-fixture" as const,
        }),
    }),
    Layer.succeed(PiSessionReferencePort, {
      getPiSessionReference: () => Effect.succeed(undefined),
      savePiSessionReference: (input) =>
        Effect.succeed({ value: input.reference, afterCommit: [] }),
      deletePiSessionReference: (input) =>
        Effect.succeed({
          value: { surfacePiSessionId: input.surfacePiSessionId },
          afterCommit: [],
        }),
      validatePiSessionReference: (input) =>
        Effect.succeed({
          valid: true as const,
          reference:
            input.reference ??
            ({
              surfacePiSessionId: input.surfacePiSessionId,
              referenceFingerprint: "test",
              adapterKind: "test",
              adapterVersion: "test",
              storageLocator: "/tmp/test.jsonl",
            } as never),
          referenceFingerprint: "test",
        }),
    }),
  );
}

describe("@svvy/runtime surface runtime scope service", () => {
  it.effect("serializes close and immediate reopen for the same surface pi session", () => {
    let closeStarted: Deferred.Deferred<void>;
    let allowClose: Deferred.Deferred<void>;
    let opens = 0;
    let closes = 0;

    return Effect.gen(function* () {
      closeStarted = yield* Deferred.make<void>();
      allowClose = yield* Deferred.make<void>();
      const service = yield* RuntimeSurfaceScopeService;

      yield* service.open({ workspaceId, surfacePiSessionId, actorKind: "orchestrator" });
      const closeFiber = yield* service.release({ surfacePiSessionId }).pipe(Effect.forkDetach);
      yield* Deferred.await(closeStarted);

      const reopenFiber = yield* service
        .open({ workspaceId, surfacePiSessionId, actorKind: "orchestrator" })
        .pipe(Effect.forkDetach);
      yield* Effect.yieldNow;

      assert.strictEqual(opens, 1);
      assert.strictEqual(closes, 1);

      yield* Deferred.succeed(allowClose, undefined);
      yield* Fiber.join(closeFiber);
      const reopened = yield* Fiber.join(reopenFiber);

      assert.strictEqual(reopened.surfacePiSessionId, surfacePiSessionId);
      assert.strictEqual(opens, 2);
      assert.strictEqual(closes, 1);
      assert.deepStrictEqual(yield* service.snapshot(), [
        { surfacePiSessionId, retainCount: 1, activeTurnId: null },
      ]);
    }).pipe(
      Effect.provide(layerRuntimeSurfaceScopeService),
      Effect.provide(
        surfaceScopeDependencies({
          onOpen: () => {
            opens += 1;
          },
          close: () =>
            Effect.gen(function* () {
              closes += 1;
              yield* Deferred.succeed(closeStarted, undefined);
              yield* Deferred.await(allowClose);
            }),
        }),
      ),
    );
  });

  it.effect("closes a zero-retain surface after its active prompt settles", () => {
    let closes = 0;
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* RuntimeSurfaceScopeService;
        const surface = yield* service.open({
          workspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
        });
        const promptEntered = yield* Deferred.make<void>();
        const allowPrompt = yield* Deferred.make<void>();
        const turnId = "turn_surface_pending_release";
        const promptFiber = yield* Deferred.succeed(promptEntered, undefined).pipe(
          Effect.andThen(Deferred.await(allowPrompt)),
          Effect.ensuring(surface.clearActivePrompt({ turnId })),
          Effect.forkScoped,
        );
        yield* surface.installActivePrompt({ turnId, fiber: promptFiber });
        yield* Deferred.await(promptEntered);

        yield* service.release({ surfacePiSessionId });
        assert.deepStrictEqual(yield* service.snapshot(), [
          { surfacePiSessionId, retainCount: 0, activeTurnId: turnId },
        ]);
        assert.strictEqual(closes, 0);

        yield* Deferred.succeed(allowPrompt, undefined);
        yield* Fiber.join(promptFiber);
        assert.strictEqual(closes, 1);
        assert.deepStrictEqual(yield* service.snapshot(), []);
      }),
    ).pipe(
      Effect.provide(layerRuntimeSurfaceScopeService),
      Effect.provide(
        surfaceScopeDependencies({
          close: () =>
            Effect.sync(() => {
              closes += 1;
            }),
        }),
      ),
    );
  });

  it.effect("joins forced active-prompt interruption through prompt finalizers", () => {
    let interruptionReturned = false;
    let promptFinalizerFinished = false;
    return Effect.scoped(
      Effect.gen(function* () {
        const service = yield* RuntimeSurfaceScopeService;
        const surface = yield* service.open({
          workspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
        });
        const promptEntered = yield* Deferred.make<void>();
        const finalizerEntered = yield* Deferred.make<void>();
        const allowFinalizer = yield* Deferred.make<void>();
        const turnId = "turn_surface_force_interrupt";
        const promptFiber = yield* Deferred.succeed(promptEntered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Deferred.succeed(finalizerEntered, undefined).pipe(
              Effect.andThen(Deferred.await(allowFinalizer)),
              Effect.andThen(
                Effect.sync(() => {
                  promptFinalizerFinished = true;
                }),
              ),
              Effect.andThen(surface.clearActivePrompt({ turnId })),
            ),
          ),
          Effect.forkScoped,
        );
        yield* surface.installActivePrompt({ turnId, fiber: promptFiber });
        yield* Deferred.await(promptEntered);

        const interruption = yield* service
          .interrupt({
            surfacePiSessionId,
            turnId,
            reason: "runtime-shutdown",
            force: true,
          })
          .pipe(
            Effect.andThen(
              Effect.sync(() => {
                interruptionReturned = true;
              }),
            ),
            Effect.forkScoped,
          );
        yield* Deferred.await(finalizerEntered);
        assert.isFalse(interruptionReturned);
        assert.isFalse(promptFinalizerFinished);

        yield* Deferred.succeed(allowFinalizer, undefined);
        yield* Fiber.join(interruption);
        assert.isTrue(interruptionReturned);
        assert.isTrue(promptFinalizerFinished);
        assert.deepStrictEqual(yield* service.snapshot(), [
          { surfacePiSessionId, retainCount: 1, activeTurnId: null },
        ]);
      }),
    ).pipe(
      Effect.provide(layerRuntimeSurfaceScopeService),
      Effect.provide(surfaceScopeDependencies()),
    );
  });

  it.effect("closes retained surfaces when the service layer scope closes", () => {
    let closes = 0;
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const service = yield* RuntimeSurfaceScopeService;
        yield* service.open({
          workspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
        });
        assert.strictEqual(closes, 0);
      }).pipe(
        Effect.provide(layerRuntimeSurfaceScopeService),
        Effect.provide(
          surfaceScopeDependencies({
            close: () =>
              Effect.sync(() => {
                closes += 1;
              }),
          }),
        ),
      );
      assert.strictEqual(closes, 1);
    });
  });
});
