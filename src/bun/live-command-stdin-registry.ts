import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  type CancelCommandResult,
  type WriteCommandStdinResult,
} from "@svvy/core";
import type {
  RuntimeLayerCommandControlPortService,
  RuntimeLayerCommandStdinPortService,
} from "@svvy/runtime/bootstrap";

export type LiveCommandStdinAdmissionResult =
  | { readonly status: "accepted"; readonly acceptedBytes: number }
  | { readonly status: "stdin_closed" | "not_running" | "already_terminal" };

export type LiveCommandCancelResult = {
  readonly status: "cancelling" | "cancelled" | "already_terminal";
};

export type LiveCommandStdinRegistration = {
  readonly commandId: string;
  readonly sessionId: string;
  writeStdin(text: string): LiveCommandStdinAdmissionResult;
  cancel(reason?: string): LiveCommandCancelResult;
};

export type LiveCommandStdinRegistry = RuntimeLayerCommandStdinPortService &
  Pick<RuntimeLayerCommandControlPortService, "cancel"> & {
    register(input: LiveCommandStdinRegistration): void;
    unregister(input: { readonly commandId: string; readonly sessionId: string }): void;
  };

export function createLiveCommandStdinRegistry(): LiveCommandStdinRegistry {
  const entries = new Map<string, LiveCommandStdinRegistration>();
  return {
    register(input) {
      entries.set(input.commandId, input);
    },
    unregister(input) {
      const existing = entries.get(input.commandId);
      if (existing?.sessionId === input.sessionId) {
        entries.delete(input.commandId);
      }
    },
    writeStdin(input) {
      return Effect.sync<WriteCommandStdinResult>(() => {
        const entry = entries.get(input.commandId);
        if (!entry) {
          return { commandId: input.commandId, status: "not_running" };
        }
        const result = entry.writeStdin(input.text);
        if (result.status === "accepted") {
          return {
            commandId: input.commandId,
            status: "accepted",
            acceptedBytes: result.acceptedBytes,
          };
        }
        if (result.status === "already_terminal" || result.status === "not_running") {
          entries.delete(input.commandId);
        }
        return { commandId: input.commandId, status: result.status };
      });
    },
    cancel(input) {
      return Effect.gen(function* () {
        const entry = entries.get(input.commandId);
        if (!entry) {
          return yield* Effect.fail(
            new RuntimeContractError({
              operation: "runtime.commands.cancel",
              reason: "target-not-found",
              message: `No live command session is registered for command ${input.commandId}.`,
            }),
          );
        }
        const result = entry.cancel(input.reason);
        if (result.status === "already_terminal" || result.status === "cancelled") {
          entries.delete(input.commandId);
        }
        return {
          commandId: input.commandId,
          status: result.status,
        } satisfies CancelCommandResult;
      });
    },
  };
}
