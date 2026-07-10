import * as Effect from "effect/Effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import {
  RuntimeAppLogCommitNotification,
  type RuntimeAppLogCommitNotificationInput,
  type RuntimeAppLogCommitNotificationService,
} from "./runtime-app-log-commit-notification";

export type AppLogCommitNotificationInput = RuntimeAppLogCommitNotificationInput;

export function notifyCommittedAppLogAppend<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: AppLogCommitNotificationInput,
): Promise<void> {
  return managedRuntime.runPromise(
    Effect.gen(function* () {
      const notifications: RuntimeAppLogCommitNotificationService =
        yield* RuntimeAppLogCommitNotification;
      yield* notifications.notifyCommittedAppend(input);
    }) as Effect.Effect<void, unknown, never>,
  );
}
