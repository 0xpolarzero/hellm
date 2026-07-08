import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import {
  RuntimeContractError,
  type CommandId,
  type RuntimeApprovalId,
  type RuntimeApprovalRecord,
  type SurfacePiSessionId,
  type ToolItemId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { makeRuntimeApprovalWaitService } from "./runtime-approval-wait-service";

const requestId = "approval_wait_service_01" as RuntimeApprovalId;
const sessionId = "wsess_approval_wait_service_01" as WorkspaceSessionId;
const surfacePiSessionId = "pi_approval_wait_service_01" as SurfacePiSessionId;
const commandId = "command_approval_wait_service_01" as CommandId;

function approvalRecord(id: RuntimeApprovalId = requestId): RuntimeApprovalRecord {
  return {
    requestId: id,
    sessionId,
    surfacePiSessionId,
    threadId: null,
    turnId: null,
    commandId,
    toolCallId: "tool_approval_wait_service_01" as ToolItemId,
    toolName: "exec_command",
    approvalMode: "user",
    cwd: "/tmp/approval-wait-service",
    command: "bun run check",
    commandFamily: "bun",
    patch: null,
    snippetArtifactId: null,
    typescriptCode: null,
    context: null,
    status: "pending",
    decisionReason: null,
    reviewer: null,
    createdAt: "2026-04-18T09:00:00.000Z",
    completedAt: null,
  };
}

describe("RuntimeApprovalWaitService", () => {
  it.effect("resolves approved waits after the committed approval transition", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const request = approvalRecord();
        const fiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* service.afterApprovalCommitted({ request, approved: true, reason: null });
        const result = yield* Fiber.join(fiber);

        assert.deepStrictEqual(result, { approved: true });
      }),
    ),
  );

  it.effect("resolves denied waits with explicit and default reasons", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const explicitRequest = approvalRecord();
        const explicitFiber = yield* service
          .waitForApproval({ request: explicitRequest })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* service.afterApprovalCommitted({
          request: explicitRequest,
          approved: false,
          reason: "Denied by reviewer.",
        });
        assert.deepStrictEqual(yield* Fiber.join(explicitFiber), {
          approved: false,
          reason: "Denied by reviewer.",
        });

        const defaultRequest = approvalRecord("approval_wait_service_02" as RuntimeApprovalId);
        const defaultFiber = yield* service
          .waitForApproval({ request: defaultRequest })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* service.afterApprovalCommitted({
          request: defaultRequest,
          approved: false,
          reason: null,
        });
        assert.deepStrictEqual(yield* Fiber.join(defaultFiber), {
          approved: false,
          reason: "Runtime action was not approved.",
        });
      }),
    ),
  );

  it.effect("cancels one waiting approval as a denied decision", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const request = approvalRecord();
        const fiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* service.cancelApprovalWait({ request, reason: "Surface closed." });
        const result = yield* Fiber.join(fiber);

        assert.deepStrictEqual(result, { approved: false, reason: "Surface closed." });
      }),
    ),
  );

  it.effect("rejects all pending waits on shutdown cancellation", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const first = approvalRecord("approval_wait_service_all_01" as RuntimeApprovalId);
        const second = approvalRecord("approval_wait_service_all_02" as RuntimeApprovalId);
        const firstFiber = yield* service
          .waitForApproval({ request: first })
          .pipe(Effect.forkScoped);
        const secondFiber = yield* service
          .waitForApproval({ request: second })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* service.cancelAllApprovalWaits({ reason: "Runtime shutdown." });
        const firstError = yield* Fiber.join(firstFiber).pipe(Effect.flip);
        const secondError = yield* Fiber.join(secondFiber).pipe(Effect.flip);

        assert.strictEqual(firstError.reason, "runtime-shutdown");
        assert.strictEqual(secondError.reason, "runtime-shutdown");
        assert.match(firstError.message, /Runtime shutdown/);
        assert.match(secondError.message, /Runtime shutdown/);
      }),
    ),
  );

  it.effect("removes entries after completion so a request id can wait again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const request = approvalRecord();
        const firstFiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        yield* service.afterApprovalCommitted({ request, approved: true, reason: null });
        assert.deepStrictEqual(yield* Fiber.join(firstFiber), { approved: true });

        const secondFiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* service.cancelApprovalWait({ request, reason: "Cancelled later." });
        assert.deepStrictEqual(yield* Fiber.join(secondFiber), {
          approved: false,
          reason: "Cancelled later.",
        });
      }),
    ),
  );

  it.effect("ignores committed and cancelled transitions for non-waiting approvals", () =>
    Effect.gen(function* () {
      const service = yield* makeRuntimeApprovalWaitService();
      const request = approvalRecord();

      yield* service.afterApprovalCommitted({ request, approved: true, reason: null });
      yield* service.cancelApprovalWait({ request, reason: "No waiter." });

      assert.ok(true);
    }),
  );

  it.effect("rejects duplicate waits without removing the original waiter", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const request = approvalRecord();
        const firstFiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;

        const duplicateError = yield* service.waitForApproval({ request }).pipe(Effect.flip);

        assert.ok(duplicateError instanceof RuntimeContractError);
        assert.strictEqual(duplicateError.reason, "state-conflict");
        assert.match(duplicateError.message, /already waiting/);

        yield* service.afterApprovalCommitted({ request, approved: true, reason: null });
        assert.deepStrictEqual(yield* Fiber.join(firstFiber), { approved: true });
      }),
    ),
  );

  it.effect("removes interrupted waits so a request id can wait again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const request = approvalRecord();
        const firstFiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* Fiber.interrupt(firstFiber);

        const secondFiber = yield* service.waitForApproval({ request }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* service.cancelApprovalWait({ request, reason: "Registered again." });

        assert.deepStrictEqual(yield* Fiber.join(secondFiber), {
          approved: false,
          reason: "Registered again.",
        });
      }),
    ),
  );

  it.effect("keeps the first terminal approval wait decision", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const service = yield* makeRuntimeApprovalWaitService();
        const commitFirst = approvalRecord("approval_wait_service_order_01" as RuntimeApprovalId);
        const commitFirstFiber = yield* service
          .waitForApproval({ request: commitFirst })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* service.afterApprovalCommitted({
          request: commitFirst,
          approved: true,
          reason: null,
        });
        yield* service.cancelApprovalWait({ request: commitFirst, reason: "Too late." });
        assert.deepStrictEqual(yield* Fiber.join(commitFirstFiber), { approved: true });

        const cancelFirst = approvalRecord("approval_wait_service_order_02" as RuntimeApprovalId);
        const cancelFirstFiber = yield* service
          .waitForApproval({ request: cancelFirst })
          .pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        yield* service.cancelApprovalWait({ request: cancelFirst, reason: "Cancelled first." });
        yield* service.afterApprovalCommitted({
          request: cancelFirst,
          approved: true,
          reason: null,
        });
        assert.deepStrictEqual(yield* Fiber.join(cancelFirstFiber), {
          approved: false,
          reason: "Cancelled first.",
        });
      }),
    ),
  );
});
