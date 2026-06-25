import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  StateContractError,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
} from "@svvy/core";
import {
  createSurfaceQueueDispatcher,
  type SurfaceQueueDispatchHost,
} from "./surface-queue-dispatcher";
import { runTestEffect } from "./effect.test-support";

type TestTarget = { surfacePiSessionId: string };
type TestSurface = {
  active: boolean;
  activePromptDone: Promise<void> | null;
  continueAfterActive: boolean;
  continueAfterPrompt: boolean;
};

function createQueued(id: string): RuntimeSurfaceMessageRecord {
  return {
    id,
    sessionId: "session_01",
    surfacePiSessionId: "surface_01",
    threadId: null,
    workflowTaskAttemptId: null,
    kind: "user_message",
    idempotencyKey: id,
    messageJson: "{}",
    payloadJson: null,
    status: "queued",
    priority: "runtime",
    orderingKey: "surface:surface_01",
    sequence: 1,
    position: 1,
    sourceCommandId: null,
    claimOwnerId: null,
    claimLeaseExpiresAt: null,
    leaseVersion: 0,
    attemptCount: 0,
    maxAttempts: 3,
    nextAttemptAt: null,
    lastErrorJson: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    deliveredAt: null,
    failedAt: null,
    failureError: null,
    cancelledAt: null,
  };
}

function stateMutation<T>(value: T) {
  return { value, afterCommit: [] };
}

function createState(queue: RuntimeSurfaceMessageRecord[] = []) {
  const calls: string[] = [];
  const queueStatePort: RuntimeQueueStatePortService = {
    acceptSubmittedSurfaceMessage: () =>
      Effect.die("Unexpected acceptSubmittedSurfaceMessage call."),
    enqueueSurfaceMessage: () => Effect.die("Unexpected enqueueSurfaceMessage call."),
    getSurfaceQueuedMessage: () => Effect.die("Unexpected getSurfaceQueuedMessage call."),
    claimNextQueuedSurfaceMessage: () => {
      return Effect.sync(() => {
        calls.push("claim");
        return stateMutation(queue.shift() ?? null);
      });
    },
    releaseExpiredSurfaceMessageClaims: () =>
      Effect.die("Unexpected releaseExpiredSurfaceMessageClaims call."),
    markSurfaceMessageSteering: () => Effect.die("Unexpected markSurfaceMessageSteering call."),
    markSurfaceMessageDelivered: ({ id }) => {
      return Effect.sync(() => {
        calls.push(`delivered:${id}`);
        return stateMutation(createQueued(id));
      });
    },
    markSurfaceMessageFailed: ({ id, failureError }) => {
      return Effect.sync(() => {
        calls.push(`failed:${id}:${failureError}`);
        return stateMutation({ ...createQueued(id), status: "failed", failureError });
      });
    },
    markSurfaceMessageQueued: ({ id, position }) => {
      return Effect.sync(() => {
        calls.push(`queued:${id}:${position ?? "back"}`);
        return stateMutation(createQueued(id));
      });
    },
    cancelSurfaceMessage: () => Effect.die("Unexpected cancelSurfaceMessage call."),
  };
  return { queueStatePort, calls, queue };
}

function createHost(
  overrides: Partial<SurfaceQueueDispatchHost<TestTarget, TestSurface, string, string>> = {},
) {
  const calls: string[] = [];
  const surface: TestSurface = {
    active: false,
    activePromptDone: null,
    continueAfterActive: true,
    continueAfterPrompt: true,
  };
  const host: SurfaceQueueDispatchHost<TestTarget, TestSurface, string, string> = {
    isClosed: () => false,
    resolveTarget: (target) => target,
    retainSurface: async () => {
      calls.push("retain");
      return surface;
    },
    releaseSurface: async () => {
      calls.push("release");
    },
    isSurfaceActive: () => surface.active,
    activePromptDone: () => surface.activePromptDone,
    continueAfterActivePrompt: () => surface.continueAfterActive,
    hasClaimableQueuedMessage: () => true,
    refreshBeforeDispatch: async () => {
      calls.push("refresh");
      return surface;
    },
    materializeQueuedMessage: async ({ queued }) => {
      calls.push(`materialize:${queued.id}`);
      return { kind: "dispatch", message: `message:${queued.id}`, metadata: "meta" };
    },
    startPrompt: async ({ queued, message, metadata }) => {
      calls.push(`start:${queued.id}:${message}:${metadata ?? ""}`);
      return {
        promptDone: Promise.resolve(),
        continueAfterPrompt: () => surface.continueAfterPrompt,
      };
    },
    notifyQueueUpdated: async () => {
      calls.push("notify");
    },
    ...overrides,
  };
  return { host, calls, surface };
}

function runDispatcher<A>(
  queueStatePort: RuntimeQueueStatePortService,
  effect: Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort>,
): Promise<A> {
  return runTestEffect(effect.pipe(Effect.provideService(RuntimeQueueStatePort, queueStatePort)));
}

async function runtimeDispatchError<A>(
  queueStatePort: RuntimeQueueStatePortService,
  effect: Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort>,
): Promise<RuntimeContractError> {
  try {
    await runDispatcher(queueStatePort, effect);
  } catch (error) {
    return error as RuntimeContractError;
  }
  throw new Error("Expected runtime queue dispatch to fail.");
}

describe("surface queue dispatcher", () => {
  it("returns idle without claiming when the host reports no claimable rows", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost({ hasClaimableQueuedMessage: () => false });
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      ),
    ).resolves.toBe(false);

    expect(stateCalls).toEqual([]);
    expect(hostCalls).toEqual(["retain", "release"]);
  });

  it("does not claim behind an active prompt when waiting was not requested", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, surface, calls } = createHost();
    surface.active = true;
    surface.activePromptDone = Promise.resolve();
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          { awaitPrompt: false },
        ),
      ),
    ).resolves.toBe(false);

    expect(stateCalls).toEqual([]);
    expect(calls).toEqual(["retain", "release"]);
  });

  it("waits for an active prompt when requested and reuses the host continuation policy", async () => {
    let finishActivePrompt!: () => void;
    const activePromptDone = new Promise<void>((resolve) => {
      finishActivePrompt = resolve;
    });
    const { queueStatePort } = createState([createQueued("queue_01")]);
    const { host, surface, calls } = createHost();
    surface.active = true;
    surface.activePromptDone = activePromptDone;
    surface.continueAfterActive = false;
    const dispatcher = createSurfaceQueueDispatcher({ host });

    const result = runDispatcher(
      queueStatePort,
      dispatcher.drainNextQueuedSurfaceMessage(
        { surfacePiSessionId: "surface_01" },
        { awaitPrompt: true },
      ),
    );
    finishActivePrompt();

    await expect(result).resolves.toBe(false);
    expect(calls).toEqual(["retain", "release"]);
  });

  it("claims, materializes, starts, and releases an ordinary queued message", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost();
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      ),
    ).resolves.toBe(true);

    expect(stateCalls).toEqual(["claim"]);
    expect(hostCalls).toEqual([
      "retain",
      "refresh",
      "materialize:queue_01",
      "start:queue_01:message:queue_01:meta",
      "release",
    ]);
  });

  it("drains queued messages in order until no claimable row remains", async () => {
    const {
      queueStatePort,
      calls: stateCalls,
      queue,
    } = createState([createQueued("queue_01"), createQueued("queue_02")]);
    const { host, calls: hostCalls } = createHost({
      hasClaimableQueuedMessage: () => queue.length > 0,
    });
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainSurfaceQueue({ surfacePiSessionId: "surface_01" }),
      ),
    ).resolves.toBeUndefined();

    expect(stateCalls).toEqual(["claim", "claim"]);
    expect(hostCalls).toEqual([
      "retain",
      "refresh",
      "materialize:queue_01",
      "start:queue_01:message:queue_01:meta",
      "release",
      "retain",
      "refresh",
      "materialize:queue_02",
      "start:queue_02:message:queue_02:meta",
      "release",
      "retain",
      "release",
    ]);
  });

  it("marks materialization failures on the queue row and releases the surface", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost({
      materializeQueuedMessage: async () => {
        throw new Error("Malformed queued payload.");
      },
    });
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.queue.dispatch.materializeQueuedMessage",
      reason: "stale-state",
      message: "Malformed queued payload.",
    });

    expect(stateCalls).toEqual(["claim", "failed:queue_01:Malformed queued payload."]);
    expect(hostCalls).toEqual(["retain", "refresh", "notify", "release"]);
  });

  it("can settle a claimed row as delivered without starting a prompt", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost({
      materializeQueuedMessage: async () => ({ kind: "delivered" }),
    });
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      ),
    ).resolves.toBe(true);

    expect(stateCalls).toEqual(["claim", "delivered:queue_01"]);
    expect(hostCalls).toEqual(["retain", "refresh", "release"]);
  });

  it("requeues the claimed row at the front when prompt start fails", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost({
      startPrompt: async () => {
        throw new Error("Prompt start failed.");
      },
    });
    const dispatcher = createSurfaceQueueDispatcher({ host });

    await expect(
      runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.queue.dispatch.startPrompt",
      reason: "stale-state",
      message: "Prompt start failed.",
    });

    expect(stateCalls).toEqual(["claim", "queued:queue_01:front"]);
    expect(hostCalls).toEqual(["retain", "refresh", "materialize:queue_01", "notify", "release"]);
  });

  it("fails invalid dispatch targets with a typed runtime contract error", async () => {
    const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost();
    const dispatcher = createSurfaceQueueDispatcher({
      host: host as SurfaceQueueDispatchHost<unknown, TestSurface, string, string>,
    });

    const error = await runtimeDispatchError(
      queueStatePort,
      dispatcher.drainNextQueuedSurfaceMessage({}, { awaitPrompt: false }),
    );

    expect(error).toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.queue.dispatch.resolveTargetSurface",
      reason: "invalid-input",
      message: "Runtime queue dispatch target must expose surfacePiSessionId.",
    });
    expect(stateCalls).toEqual([]);
    expect(hostCalls).toEqual([]);
  });

  it("maps queue state failures to typed runtime contract errors", async () => {
    const { queueStatePort } = createState([createQueued("queue_01")]);
    const { host, calls: hostCalls } = createHost();
    const dispatcher = createSurfaceQueueDispatcher({ host });
    const failingQueueStatePort: RuntimeQueueStatePortService = {
      ...queueStatePort,
      claimNextQueuedSurfaceMessage: () =>
        Effect.fail(
          new StateContractError({
            operation: "state.queue.claimNext",
            reason: "transaction-failed",
            message: "Queue claim transaction failed.",
          }),
        ),
    };

    const error = await runtimeDispatchError(
      failingQueueStatePort,
      dispatcher.drainNextQueuedSurfaceMessage(
        { surfacePiSessionId: "surface_01" },
        { awaitPrompt: false },
      ),
    );

    expect(error).toMatchObject({
      _tag: "RuntimeContractError",
      operation: "runtime.queue.dispatch.claimNext",
      reason: "state-conflict",
      message: "Queue claim transaction failed.",
    });
    expect(hostCalls).toEqual(["retain", "refresh"]);
  });
});
