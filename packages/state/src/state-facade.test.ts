import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { AppLogWritePort, IsoDateTimeStringSchema, StateContractError } from "@svvy/core";
import type { AppLogEntryId, WorkspaceId } from "@svvy/core";
import {
  StateFacadeError,
  StateReadModels,
  createStateCommandsFacade,
  createStateFacade,
  layer,
  type StateReadModelResult,
} from "./state-facade";

const iso = (value: string) => value as typeof IsoDateTimeStringSchema.Type;
const noop = () => {};

describe("State app-log facade slice", () => {
  it("reads app-log read models through the final StateFacade surface", async () => {
    const managedRuntime = ManagedRuntime.make(
      layer({ appLogs: { now: () => "2026-06-21T12:00:00.000Z" } }),
    );
    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            workspaceId: "workspace_state_facade_read" as WorkspaceId,
            level: "warn",
            source: "app.lifecycle",
            message: "AUTH_TOKEN=secret-value-here was ignored",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
        }),
      );

      const state = createStateFacade(managedRuntime);
      const logs = await state.readModels.fetch({
        kind: "appLogs",
        workspaceId: "workspace_state_facade_read" as WorkspaceId,
        query: { limit: 10 },
      });
      const summary = await state.readModels.fetch({
        kind: "appLogSummary",
        workspaceId: "workspace_state_facade_read" as WorkspaceId,
      });

      expect(logs.kind).toBe("appLogs");
      if (logs.kind !== "appLogs") throw new Error("Expected appLogs read model.");
      expect(logs.value.entries).toHaveLength(1);
      expect(logs.value.entries[0]?.message).toBe("AUTH_TOKEN=[REDACTED] was ignored");
      expect(summary).toEqual({
        kind: "appLogSummary",
        value: {
          latestSeq: 1,
          seenSeq: 0,
          unread: { total: 1, debug: 0, info: 0, warn: 1, error: 0 },
          totals: { total: 1, debug: 0, info: 0, warn: 1, error: 0 },
        },
      });
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("runs app-log read-state commands and publishes committed invalidations", async () => {
    const workspaceId = "workspace_state_facade_command" as WorkspaceId;
    const managedRuntime = ManagedRuntime.make(
      layer({ appLogs: { now: () => "2026-06-21T12:00:00.000Z" } }),
    );
    const published: unknown[] = [];

    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            workspaceId,
            level: "info",
            source: "workspace",
            message: "first",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
          yield* appLogWritePort.append({
            workspaceId,
            level: "error",
            source: "workspace",
            message: "second",
            occurredAt: iso("2026-06-21T12:01:00.000Z"),
          });
        }),
      );

      const commands = createStateCommandsFacade(managedRuntime, {
        invalidationSink: {
          publishCommittedStateInvalidations: async (input) => {
            published.push(input);
          },
        },
      });

      const first = await commands.appLogs.markRead({
        workspaceId,
        entryIds: ["app-log-1" as AppLogEntryId],
        readAt: "2026-06-21T12:02:00.000Z",
        clientSubmission: { clientRequestId: "mark-read-1", source: "test" },
      });
      const duplicate = await commands.appLogs.markRead({
        workspaceId,
        entryIds: ["app-log-1" as AppLogEntryId],
        readAt: "2026-06-21T12:02:00.000Z",
        clientSubmission: { clientRequestId: "mark-read-1", source: "test" },
      });
      const state = createStateFacade(managedRuntime);
      const summary = await state.readModels.fetch({ kind: "appLogSummary", workspaceId });

      expect(first.receipt).toMatchObject({
        clientRequestId: "mark-read-1",
        outcome: "applied",
        committedAt: "2026-06-21T12:02:00.000Z",
        stateRevision: 2,
      });
      expect(duplicate.receipt).toMatchObject({
        clientRequestId: "mark-read-1",
        outcome: "duplicate",
      });
      expect(summary.kind).toBe("appLogSummary");
      if (summary.kind !== "appLogSummary") throw new Error("Expected appLogSummary read model.");
      expect(summary.value.seenSeq).toBe(1);
      expect(summary.value.unread).toEqual({ total: 1, debug: 0, info: 0, warn: 0, error: 1 });
      expect(published).toEqual([
        {
          source: "state-command-facade",
          descriptors: [{ scope: "workspace", workspaceId, invalidation: { model: "appLogs" } }],
          clientSubmission: { clientRequestId: "mark-read-1", source: "test" },
        },
      ]);
      commands.close();
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("maps invalid app-log command input to a typed StateFacadeError", async () => {
    const managedRuntime = ManagedRuntime.make(layer());
    try {
      const commands = createStateCommandsFacade(managedRuntime);
      await expect(
        commands.appLogs.clearWorkspaceUnread({
          readAt: "2026-06-21T12:00:00.000Z",
          clientSubmission: { clientRequestId: 123 },
        } as never),
      ).rejects.toMatchObject({
        name: "StateFacadeError",
        type: "state-facade-error",
        reason: "typed-failure",
      });
      await commands.appLogs
        .clearWorkspaceUnread({
          readAt: "2026-06-21T12:00:00.000Z",
          clientSubmission: { clientRequestId: 123 },
        } as never)
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(StateFacadeError);
          expect((error as { error?: unknown }).error).toBeUndefined();
          const contract = (error as StateFacadeError).contract;
          expect(contract.reason).toBe("typed-failure");
          expect(contract).toMatchObject({
            reason: "typed-failure",
            error: { reason: "invalid-input" },
          });
          if (contract.reason === "typed-failure") {
            expect(contract.error).toBeInstanceOf(StateContractError);
          }
        });
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("rejects excess app-log command fields at the state facade boundary", async () => {
    const managedRuntime = ManagedRuntime.make(layer());
    try {
      const commands = createStateCommandsFacade(managedRuntime);
      await commands.appLogs
        .clearWorkspaceUnread({
          workspaceId: "workspace_state_facade_extra" as WorkspaceId,
          readAt: "2026-06-21T12:00:00.000Z",
          clientSubmission: { clientRequestId: "extra-command-field", source: "test" },
          previewOnly: "not a command contract field",
        } as never)
        .then(
          () => {
            throw new Error("Expected excess command field to fail.");
          },
          (error: unknown) => {
            expect(error).toBeInstanceOf(StateFacadeError);
            const contract = (error as StateFacadeError).contract;
            expect(contract.reason).toBe("typed-failure");
            if (contract.reason === "typed-failure") {
              expect(contract.error).toBeInstanceOf(StateContractError);
              expect(contract.error.reason).toBe("invalid-input");
            }
          },
        );
      commands.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("interrupts the running Effect when a facade AbortSignal aborts after admission", async () => {
    const controller = new AbortController();
    let notifyStarted: () => void = noop;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let finalized = false;
    const blockingRead = Effect.sync(() => notifyStarted()).pipe(
      Effect.flatMap(() => Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          finalized = true;
        }),
      ),
    ) as Effect.Effect<StateReadModelResult, StateContractError>;
    const managedRuntime = ManagedRuntime.make(
      Layer.succeed(
        StateReadModels,
        StateReadModels.of({
          fetch: () => blockingRead,
          refetchInvalidation: () => Effect.die("unused refetchInvalidation"),
          rebaseline: () => Effect.die("unused rebaseline"),
        }),
      ),
    );

    try {
      const state = createStateFacade(managedRuntime);
      const promise = state.readModels.fetch(
        { kind: "appLogSummary", workspaceId: "workspace_abort" as WorkspaceId },
        { signal: controller.signal },
      );
      await started;
      controller.abort();

      await expect(promise).rejects.toMatchObject({
        name: "StateFacadeError",
        type: "state-facade-error",
        reason: "interrupted",
      });
      expect(finalized).toBe(true);
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });
});
