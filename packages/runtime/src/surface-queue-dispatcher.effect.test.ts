import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { assert, describe, it } from "@effect/vitest";
import {
  RuntimeContractError,
  RuntimeQueueStatePort,
  RuntimeTurnStatePort,
  StateContractError,
  type PositiveDurationMs,
  type RuntimeOwnerId,
  type RuntimeQueueStatePortService,
  type RuntimeSurfaceMessageRecord,
  type RuntimeTurnRecord,
  type RuntimeTurnStatePortService,
  type WorkspaceId,
} from "@svvy/core";
import {
  createRuntimeSurfaceQueueDispatcher,
  createSurfaceQueueDispatcher,
  type SurfaceQueueDispatchHost,
} from "./surface-queue-dispatcher";

type TestTarget = { surfacePiSessionId: string };
type TestSurface = {
  active: boolean;
  activePromptDone: Promise<void> | null;
  continueAfterActive: boolean;
  continueAfterPrompt: boolean;
};
type TestPreparedTurn = { readonly seed: string };

const TEST_CLAIM_OWNER_ID = "surface_queue_dispatcher_test_owner" as RuntimeOwnerId;
const TEST_LEASE_DURATION_MS = 12_345 as PositiveDurationMs;
const TEST_CLAIM_CALL = `claim:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_DURATION_MS}:surface_01`;
const TEST_LEASE_VERSION = 7;

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
    claimOwnerId: TEST_CLAIM_OWNER_ID,
    claimLeaseExpiresAt: null,
    leaseVersion: TEST_LEASE_VERSION,
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

function createTurn(id: string, queued: RuntimeSurfaceMessageRecord): RuntimeTurnRecord {
  return {
    id,
    sessionId: queued.sessionId,
    surfacePiSessionId: queued.surfacePiSessionId,
    threadId: queued.threadId,
    requestSummary: `summary:${queued.id}`,
    turnDecision: "pending",
    status: "running",
    assistantMessageId: null,
    assistantText: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt: null,
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
    claimNextQueuedSurfaceMessage: (input) => {
      return Effect.sync(() => {
        calls.push(
          `claim:${input.claimOwnerId ?? ""}:${input.leaseDurationMs ?? ""}:${
            input.surfacePiSessionId
          }`,
        );
        return stateMutation(queue.shift() ?? null);
      });
    },
    releaseExpiredSurfaceMessageClaims: () =>
      Effect.die("Unexpected releaseExpiredSurfaceMessageClaims call."),
    markSurfaceMessageSteering: () => Effect.die("Unexpected markSurfaceMessageSteering call."),
    markSurfaceMessageDelivered: ({ id, claimOwnerId, leaseVersion }) => {
      return Effect.sync(() => {
        calls.push(`delivered:${id}:${claimOwnerId ?? ""}:${leaseVersion ?? ""}`);
        return stateMutation(createQueued(id));
      });
    },
    markSurfaceMessageFailed: ({ id, failureError, claimOwnerId, leaseVersion }) => {
      return Effect.sync(() => {
        calls.push(`failed:${id}:${failureError}:${claimOwnerId ?? ""}:${leaseVersion ?? ""}`);
        return stateMutation({ ...createQueued(id), status: "failed", failureError });
      });
    },
    markSurfaceMessageQueued: ({ id, position, claimOwnerId, leaseVersion }) => {
      return Effect.sync(() => {
        calls.push(
          `queued:${id}:${position ?? "back"}:${claimOwnerId ?? ""}:${leaseVersion ?? ""}`,
        );
        return stateMutation(createQueued(id));
      });
    },
    cancelSurfaceMessage: () => Effect.die("Unexpected cancelSurfaceMessage call."),
  };
  return { queueStatePort, calls, queue };
}

function createTurnState() {
  const calls: string[] = [];
  let nextTurnIndex = 1;
  const turnStatePort: RuntimeTurnStatePortService = {
    startTurn: (input) =>
      Effect.sync(() => {
        const queued = createQueued(`queue_for_turn_${nextTurnIndex}`);
        const turn: RuntimeTurnRecord = {
          ...createTurn(`turn_${nextTurnIndex}`, {
            ...queued,
            sessionId: input.sessionId,
            surfacePiSessionId: input.surfacePiSessionId,
            threadId: input.threadId ?? null,
          }),
          requestSummary: input.requestSummary,
        };
        nextTurnIndex += 1;
        calls.push(
          `startTurn:${input.sessionId}:${input.surfacePiSessionId}:${input.threadId ?? "null"}:${input.requestSummary}:${turn.id}`,
        );
        return stateMutation(turn);
      }),
    setTurnDecision: () => Effect.die("Unexpected setTurnDecision call."),
    finishTurn: ({ turnId, status }) =>
      Effect.sync(() => {
        calls.push(`finishTurn:${turnId}:${status}`);
        return stateMutation({
          ...createTurn(turnId, createQueued("finished_queue")),
          status,
          finishedAt: "2026-04-18T09:01:00.000Z",
        });
      }),
    queueTopLevelTitleGeneration: ({ sessionId, surfacePiSessionId }) =>
      Effect.sync(() => {
        calls.push(`queueTopLevelTitleGeneration:${sessionId}:${surfacePiSessionId}`);
        return stateMutation({
          queued: true,
          sessionId,
          surfacePiSessionId,
          title: "",
        });
      }),
  };
  return { turnStatePort, calls };
}

function createHost(
  overrides: Partial<
    SurfaceQueueDispatchHost<TestTarget, TestSurface, string, string, TestPreparedTurn>
  > = {},
) {
  const calls: string[] = [];
  const surface: TestSurface = {
    active: false,
    activePromptDone: null,
    continueAfterActive: true,
    continueAfterPrompt: true,
  };
  const host: SurfaceQueueDispatchHost<TestTarget, TestSurface, string, string, TestPreparedTurn> =
    {
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
      refreshBeforeDispatch: async () => {
        calls.push("refresh");
        return surface;
      },
      materializeQueuedMessage: async ({ queued }) => {
        calls.push(`materialize:${queued.id}`);
        return { kind: "dispatch", message: `message:${queued.id}`, metadata: "meta" };
      },
      prepareTurn: async ({ queued, message }) => {
        calls.push(`prepare:${queued.id}:${message}`);
        return {
          startTurnInput: {
            sessionId: queued.sessionId,
            surfacePiSessionId: queued.surfacePiSessionId,
            threadId: queued.threadId,
            requestSummary: `summary:${queued.id}`,
          },
          prepared: { seed: `seed:${queued.id}` },
        };
      },
      startPrompt: async ({ queued, turn, prepared, message, metadata }) => {
        calls.push(`start:${queued.id}:${turn.id}:${prepared.seed}:${message}:${metadata ?? ""}`);
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

function createTestDispatcher(
  host: SurfaceQueueDispatchHost<TestTarget, TestSurface, string, string, TestPreparedTurn>,
) {
  return createSurfaceQueueDispatcher({
    host,
    claimOwnerId: TEST_CLAIM_OWNER_ID,
    leaseDurationMs: TEST_LEASE_DURATION_MS,
  });
}

function runDispatcher<A>(
  queueStatePort: RuntimeQueueStatePortService,
  effect: Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort>,
): Effect.Effect<A, RuntimeContractError> {
  const { turnStatePort } = createTurnState();
  return runDispatcherWithState(queueStatePort, turnStatePort, effect);
}

function runDispatcherWithState<A>(
  queueStatePort: RuntimeQueueStatePortService,
  turnStatePort: RuntimeTurnStatePortService,
  effect: Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort>,
): Effect.Effect<A, RuntimeContractError> {
  return effect.pipe(
    Effect.provideService(RuntimeTurnStatePort, turnStatePort),
    Effect.provideService(RuntimeQueueStatePort, queueStatePort),
  );
}

function runtimeDispatchError<A>(
  queueStatePort: RuntimeQueueStatePortService,
  effect: Effect.Effect<A, RuntimeContractError, RuntimeQueueStatePort | RuntimeTurnStatePort>,
): Effect.Effect<RuntimeContractError, A> {
  return runDispatcher(queueStatePort, effect).pipe(Effect.flip);
}

describe("surface queue dispatcher", () => {
  it.effect(
    "runtime dispatcher factory derives the claim owner and lease from workspace policy",
    () =>
      Effect.gen(function* () {
        const workspaceId = "workspace_policy_01" as WorkspaceId;
        const queueClaimLeaseMs = 54_321 as PositiveDurationMs;
        const { queueStatePort, calls: stateCalls } = createState([]);
        const { host, calls: hostCalls } = createHost();
        const dispatcher = createRuntimeSurfaceQueueDispatcher({
          host,
          workspaceId,
          queueClaimLeaseMs,
        });

        const result = yield* runDispatcher(
          queueStatePort,
          dispatcher.drainNextQueuedSurfaceMessage(
            { surfacePiSessionId: "surface_01" },
            { awaitPrompt: false },
          ),
        );

        assert.strictEqual(result, false);
        assert.deepStrictEqual(stateCalls, [
          "claim:surface-queue-dispatcher:workspace_policy_01:54321:surface_01",
        ]);
        assert.deepStrictEqual(hostCalls, ["retain", "release"]);
      }),
  );

  it.effect("returns idle when the runtime queue state has no claimable rows", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([]);
      const { host, calls: hostCalls } = createHost();
      const dispatcher = createTestDispatcher(host);

      const result = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      );
      assert.strictEqual(result, false);

      assert.deepStrictEqual(stateCalls, [TEST_CLAIM_CALL]);
      assert.deepStrictEqual(hostCalls, ["retain", "release"]);
    }),
  );

  it.effect("does not claim behind an active prompt when waiting was not requested", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { host, surface, calls } = createHost();
      surface.active = true;
      surface.activePromptDone = Promise.resolve();
      const dispatcher = createTestDispatcher(host);

      const result = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          { awaitPrompt: false },
        ),
      );
      assert.strictEqual(result, false);

      assert.deepStrictEqual(stateCalls, []);
      assert.deepStrictEqual(calls, ["retain", "release"]);
    }),
  );

  it.effect(
    "waits for an active prompt when requested and reuses the host continuation policy",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          let finishActivePrompt!: () => void;
          const activePromptDone = new Promise<void>((resolve) => {
            finishActivePrompt = resolve;
          });
          const { queueStatePort } = createState([createQueued("queue_01")]);
          const { host, surface, calls } = createHost();
          surface.active = true;
          surface.activePromptDone = activePromptDone;
          surface.continueAfterActive = false;
          const dispatcher = createTestDispatcher(host);

          const fiber = yield* runDispatcher(
            queueStatePort,
            dispatcher.drainNextQueuedSurfaceMessage(
              { surfacePiSessionId: "surface_01" },
              { awaitPrompt: true },
            ),
          ).pipe(Effect.forkScoped);
          finishActivePrompt();

          const result = yield* Fiber.join(fiber);
          assert.strictEqual(result, false);
          assert.deepStrictEqual(calls, ["retain", "release"]);
        }),
      ),
  );

  it.effect("claims, materializes, starts, and releases an ordinary queued message", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { turnStatePort, calls: turnCalls } = createTurnState();
      const { host, calls: hostCalls } = createHost({
        startPrompt: async ({ queued, turn, prepared, message, metadata }) => {
          assert.deepStrictEqual(turnCalls, [
            "startTurn:session_01:surface_01:null:summary:queue_01:turn_1",
          ]);
          hostCalls.push(
            `start:${queued.id}:${turn.id}:${prepared.seed}:${message}:${metadata ?? ""}`,
          );
          return {
            promptDone: Promise.resolve(),
            continueAfterPrompt: () => true,
          };
        },
      });
      const dispatcher = createTestDispatcher(host);

      const result = yield* runDispatcherWithState(
        queueStatePort,
        turnStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      );
      assert.strictEqual(result, true);

      assert.deepStrictEqual(stateCalls, [TEST_CLAIM_CALL]);
      assert.deepStrictEqual(turnCalls, [
        "startTurn:session_01:surface_01:null:summary:queue_01:turn_1",
      ]);
      assert.deepStrictEqual(hostCalls, [
        "retain",
        "refresh",
        "materialize:queue_01",
        "prepare:queue_01:message:queue_01",
        "start:queue_01:turn_1:seed:queue_01:message:queue_01:meta",
        "release",
      ]);
    }),
  );

  it.effect("passes handler thread identity into durable turn start", () =>
    Effect.gen(function* () {
      const queued = { ...createQueued("queue_handler_01"), threadId: "thread_01" };
      const { queueStatePort } = createState([queued]);
      const { turnStatePort, calls: turnCalls } = createTurnState();
      const { host } = createHost();
      const dispatcher = createTestDispatcher(host);

      const result = yield* runDispatcherWithState(
        queueStatePort,
        turnStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      );

      assert.strictEqual(result, true);
      assert.deepStrictEqual(turnCalls, [
        "startTurn:session_01:surface_01:thread_01:summary:queue_handler_01:turn_1",
      ]);
    }),
  );

  it.effect("drains queued messages in order until no claimable row remains", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([
        createQueued("queue_01"),
        createQueued("queue_02"),
      ]);
      const { host, calls: hostCalls } = createHost();
      const dispatcher = createTestDispatcher(host);

      const result = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainSurfaceQueue({ surfacePiSessionId: "surface_01" }),
      );
      assert.strictEqual(result, undefined);

      assert.deepStrictEqual(stateCalls, [TEST_CLAIM_CALL, TEST_CLAIM_CALL, TEST_CLAIM_CALL]);
      assert.deepStrictEqual(hostCalls, [
        "retain",
        "refresh",
        "materialize:queue_01",
        "prepare:queue_01:message:queue_01",
        "start:queue_01:turn_1:seed:queue_01:message:queue_01:meta",
        "release",
        "retain",
        "refresh",
        "materialize:queue_02",
        "prepare:queue_02:message:queue_02",
        "start:queue_02:turn_2:seed:queue_02:message:queue_02:meta",
        "release",
        "retain",
        "release",
      ]);
    }),
  );

  it.effect("requeues the claimed row at the front when pre-dispatch refresh fails", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { host, calls: hostCalls } = createHost({
        refreshBeforeDispatch: async () => {
          throw new Error("Generated context refresh failed.");
        },
      });
      const dispatcher = createTestDispatcher(host);

      const error = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      ).pipe(Effect.flip);
      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.refreshBeforeDispatch",
        reason: "stale-state",
        message: "Generated context refresh failed.",
      });

      assert.deepStrictEqual(stateCalls, [
        TEST_CLAIM_CALL,
        `queued:queue_01:front:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_VERSION}`,
      ]);
      assert.deepStrictEqual(hostCalls, ["retain", "notify", "release"]);
    }),
  );

  it.effect("marks materialization failures on the queue row and releases the surface", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { host, calls: hostCalls } = createHost({
        materializeQueuedMessage: async () => {
          throw new Error("Malformed queued payload.");
        },
      });
      const dispatcher = createTestDispatcher(host);

      const error = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      ).pipe(Effect.flip);
      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.materializeQueuedMessage",
        reason: "stale-state",
        message: "Malformed queued payload.",
      });

      assert.deepStrictEqual(stateCalls, [
        TEST_CLAIM_CALL,
        `failed:queue_01:Malformed queued payload.:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_VERSION}`,
      ]);
      assert.deepStrictEqual(hostCalls, ["retain", "refresh", "notify", "release"]);
    }),
  );

  it.effect("can settle a claimed row as delivered without starting a prompt", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { host, calls: hostCalls } = createHost({
        materializeQueuedMessage: async () => ({ kind: "delivered" }),
      });
      const dispatcher = createTestDispatcher(host);

      const result = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: true,
          },
        ),
      );
      assert.strictEqual(result, true);

      assert.deepStrictEqual(stateCalls, [
        TEST_CLAIM_CALL,
        `delivered:queue_01:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_VERSION}`,
      ]);
      assert.deepStrictEqual(hostCalls, ["retain", "refresh", "release"]);
    }),
  );

  it.effect("requeues the claimed row at the front when turn preparation fails", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { host, calls: hostCalls } = createHost({
        prepareTurn: async () => {
          throw new Error("Prompt turn preparation failed.");
        },
      });
      const dispatcher = createTestDispatcher(host);

      const error = yield* runDispatcher(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      ).pipe(Effect.flip);
      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.prepareTurn",
        reason: "stale-state",
        message: "Prompt turn preparation failed.",
      });

      assert.deepStrictEqual(stateCalls, [
        TEST_CLAIM_CALL,
        `queued:queue_01:front:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_VERSION}`,
      ]);
      assert.deepStrictEqual(hostCalls, [
        "retain",
        "refresh",
        "materialize:queue_01",
        "notify",
        "release",
      ]);
    }),
  );

  it.effect("requeues the claimed row at the front when durable turn start fails", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const turnStatePort: RuntimeTurnStatePortService = {
        ...createTurnState().turnStatePort,
        startTurn: () =>
          Effect.fail(
            new StateContractError({
              operation: "structured-session.startTurn",
              reason: "transaction-failed",
              message: "Turn start transaction failed.",
            }),
          ),
      };
      const { host, calls: hostCalls } = createHost();
      const dispatcher = createTestDispatcher(host);

      const error = yield* runDispatcherWithState(
        queueStatePort,
        turnStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      ).pipe(Effect.flip);
      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.startTurn",
        reason: "state-conflict",
        message: "Turn start transaction failed.",
      });

      assert.deepStrictEqual(stateCalls, [
        TEST_CLAIM_CALL,
        `queued:queue_01:front:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_VERSION}`,
      ]);
      assert.deepStrictEqual(hostCalls, [
        "retain",
        "refresh",
        "materialize:queue_01",
        "prepare:queue_01:message:queue_01",
        "notify",
        "release",
      ]);
    }),
  );

  it.effect("finishes the started turn and fails the claimed row when prompt start fails", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { turnStatePort, calls: turnCalls } = createTurnState();
      const { host, calls: hostCalls } = createHost({
        startPrompt: async () => {
          throw new Error("Prompt start failed.");
        },
      });
      const dispatcher = createTestDispatcher(host);

      const error = yield* runDispatcherWithState(
        queueStatePort,
        turnStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          {
            awaitPrompt: false,
          },
        ),
      ).pipe(Effect.flip);
      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.startPrompt",
        reason: "stale-state",
        message: "Prompt start failed.",
      });

      assert.deepStrictEqual(stateCalls, [
        TEST_CLAIM_CALL,
        `failed:queue_01:Prompt start failed.:${TEST_CLAIM_OWNER_ID}:${TEST_LEASE_VERSION}`,
      ]);
      assert.deepStrictEqual(turnCalls, [
        "startTurn:session_01:surface_01:null:summary:queue_01:turn_1",
        "finishTurn:turn_1:failed",
      ]);
      assert.deepStrictEqual(hostCalls, [
        "retain",
        "refresh",
        "materialize:queue_01",
        "prepare:queue_01:message:queue_01",
        "notify",
        "release",
      ]);
    }),
  );

  it.effect("fails invalid dispatch targets with a typed runtime contract error", () =>
    Effect.gen(function* () {
      const { queueStatePort, calls: stateCalls } = createState([createQueued("queue_01")]);
      const { host, calls: hostCalls } = createHost();
      const dispatcher = createSurfaceQueueDispatcher({
        host: host as SurfaceQueueDispatchHost<
          unknown,
          TestSurface,
          string,
          string,
          TestPreparedTurn
        >,
        claimOwnerId: TEST_CLAIM_OWNER_ID,
        leaseDurationMs: TEST_LEASE_DURATION_MS,
      });

      const error = yield* runtimeDispatchError(
        queueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage({}, { awaitPrompt: false }),
      );

      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.resolveTargetSurface",
        reason: "invalid-input",
        message: "Runtime queue dispatch target must expose surfacePiSessionId.",
      });
      assert.deepStrictEqual(stateCalls, []);
      assert.deepStrictEqual(hostCalls, []);
    }),
  );

  it.effect("maps queue state failures to typed runtime contract errors", () =>
    Effect.gen(function* () {
      const { queueStatePort } = createState([createQueued("queue_01")]);
      const { host, calls: hostCalls } = createHost();
      const dispatcher = createTestDispatcher(host);
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

      const error = yield* runtimeDispatchError(
        failingQueueStatePort,
        dispatcher.drainNextQueuedSurfaceMessage(
          { surfacePiSessionId: "surface_01" },
          { awaitPrompt: false },
        ),
      );

      assertRuntimeError(error, {
        _tag: "RuntimeContractError",
        operation: "runtime.queue.dispatch.claimNext",
        reason: "state-conflict",
        message: "Queue claim transaction failed.",
      });
      assert.deepStrictEqual(hostCalls, ["retain", "release"]);
    }),
  );

  it.effect("releases the retained surface when dispatch is interrupted before prompt start", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const claimEntered = yield* Deferred.make<void, never>();
        const { queueStatePort } = createState([createQueued("queue_01")]);
        const blockedQueueStatePort: RuntimeQueueStatePortService = {
          ...queueStatePort,
          claimNextQueuedSurfaceMessage: () =>
            Deferred.succeed(claimEntered, undefined).pipe(
              Effect.flatMap(() => Effect.sleep(60_000)),
              Effect.as(stateMutation<RuntimeSurfaceMessageRecord | null>(null)),
            ),
        };
        const { host, calls: hostCalls } = createHost();
        const dispatcher = createTestDispatcher(host);

        const fiber = yield* runDispatcher(
          blockedQueueStatePort,
          dispatcher.drainNextQueuedSurfaceMessage(
            { surfacePiSessionId: "surface_01" },
            { awaitPrompt: false },
          ),
        ).pipe(Effect.forkScoped);

        yield* Deferred.await(claimEntered);
        yield* Fiber.interrupt(fiber);
        yield* Effect.yieldNow;

        assert.deepStrictEqual(hostCalls, ["retain", "release"]);
      }),
    ),
  );
});

function assertRuntimeError(
  error: RuntimeContractError,
  expected: {
    readonly _tag: "RuntimeContractError";
    readonly operation: string;
    readonly reason: string;
    readonly message: string;
  },
) {
  assert.deepStrictEqual(
    {
      _tag: error._tag,
      operation: error.operation,
      reason: error.reason,
      message: error.message,
    },
    expected,
  );
}
