import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";
import type { RuntimeContractError, SandboxLaunchFacts } from "@svvy/core";
import type {
  RunAcceptedLoadExtensionThroughRuntimeInput,
  RuntimeAcceptedNativeToolExecutionService,
} from "./accepted-native-tool-execution-service";
import { RuntimeAcceptedNativeToolExecution } from "./accepted-native-tool-execution-service";
import type { RunAcceptedLoadExtensionToolCallResult } from "./load-extension-operation";

export type AcceptedDirectToolLaunchHandle = {
  facts: SandboxLaunchFacts;
  close(): Promise<void>;
};

export type AcceptedDirectToolLaunchInput = Parameters<
  RuntimeAcceptedNativeToolExecutionService["acquireDirectToolLaunch"]
>[0];
export type AcceptedDirectToolApprovalInput = Parameters<
  RuntimeAcceptedNativeToolExecutionService["requestDirectToolApproval"]
>[0];
export type AcceptedDirectToolApprovalDecision =
  Awaited<
    ReturnType<RuntimeAcceptedNativeToolExecutionService["requestDirectToolApproval"]>
  > extends Effect.Effect<infer Value, infer _Error, infer _Requirements>
    ? Value
    : never;

function runManagedRuntimeEffect<A, E, R, RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  effect: Effect.Effect<A, E, R>,
): Promise<A> {
  return managedRuntime.runPromise(effect as Effect.Effect<A, E, never>);
}

export function acquireAcceptedDirectToolLaunch<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: AcceptedDirectToolLaunchInput,
): Promise<AcceptedDirectToolLaunchHandle> {
  return runManagedRuntimeEffect(
    managedRuntime,
    Effect.gen(function* () {
      const acceptedTools: RuntimeAcceptedNativeToolExecutionService =
        yield* RuntimeAcceptedNativeToolExecution;
      const scope = yield* Scope.make("sequential");
      const closeScope = () =>
        runManagedRuntimeEffect(managedRuntime, Scope.close(scope, Exit.void));
      const facts = yield* acceptedTools.acquireDirectToolLaunch(input).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.catch((cause: RuntimeContractError) =>
          Scope.close(scope, Exit.void).pipe(Effect.flatMap(() => Effect.fail(cause))),
        ),
      );
      return { facts, close: closeScope };
    }),
  );
}

export function requestAcceptedDirectToolApproval<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: AcceptedDirectToolApprovalInput,
): Promise<AcceptedDirectToolApprovalDecision> {
  return runManagedRuntimeEffect(
    managedRuntime,
    Effect.gen(function* () {
      const acceptedTools: RuntimeAcceptedNativeToolExecutionService =
        yield* RuntimeAcceptedNativeToolExecution;
      return yield* acceptedTools.requestDirectToolApproval(input);
    }),
  );
}

export function runAcceptedLoadExtension<RuntimeContext, RuntimeError>(
  managedRuntime: ManagedRuntime.ManagedRuntime<RuntimeContext, RuntimeError>,
  input: RunAcceptedLoadExtensionThroughRuntimeInput,
): Promise<RunAcceptedLoadExtensionToolCallResult> {
  return runManagedRuntimeEffect(
    managedRuntime,
    Effect.gen(function* () {
      const acceptedTools: RuntimeAcceptedNativeToolExecutionService =
        yield* RuntimeAcceptedNativeToolExecution;
      return yield* acceptedTools.runLoadExtension(input);
    }),
  );
}
