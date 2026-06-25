import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeThreadStatePort,
  StateContractError,
  type ExtensionId,
  type RuntimeSurfaceMessageRecord,
  type RuntimeThreadStatePortService,
  type StartRuntimeHandlerThreadsResult,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type WorktreeId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { getStructuredThread } from "./structured-session-selectors";
import {
  commandInspectorInvalidation,
  dedupeInvalidations,
  handlerThreadInspectorInvalidation,
  mutationResult,
  sessionNavigationInvalidation,
  surfaceInvalidation,
} from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredStartRuntimeHandlerThreadsInput,
  type StructuredStartRuntimeHandlerThreadsResult,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function mapStartHandlerThreadsResult(
  result: StructuredStartRuntimeHandlerThreadsResult,
): StartRuntimeHandlerThreadsResult {
  return {
    threadGroupId: result.threadGroupId as ThreadGroupId,
    threads: result.threads.map(({ thread, generatedAgentContextBinding, queuedMessage }) => ({
      threadId: thread.id as ThreadId,
      threadGroupId: thread.threadGroupId as ThreadGroupId,
      workspaceSessionId: thread.sessionId as WorkspaceSessionId,
      surfacePiSessionId: thread.surfacePiSessionId as SurfacePiSessionId,
      title: thread.title,
      objective: thread.objective,
      historyMode: thread.historyMode,
      objectiveState: "active",
      status: "running-handler",
      wait: null,
      worktreeId: (thread.worktree ?? null) as WorktreeId | null,
      loadedExtensionIds: thread.loadedExtensionIds as ExtensionId[],
      availableExtensionIds: thread.availableExtensionIds as ExtensionId[],
      generatedAgentContextFingerprint:
        generatedAgentContextBinding.generatedAgentContextFingerprint,
      generatedAgentContextBindingId: generatedAgentContextBinding.id,
      queuedMessage: queuedMessage as RuntimeSurfaceMessageRecord,
    })),
  };
}

function handlerThreadInvalidations(
  workspaceId: string,
  surfacePiSessionId: string,
  threadId: string,
) {
  return dedupeInvalidations([
    surfaceInvalidation(workspaceId, surfacePiSessionId),
    handlerThreadInspectorInvalidation(workspaceId, threadId),
    sessionNavigationInvalidation(workspaceId),
  ]);
}

function startHandlerThreadsInvalidations(
  workspaceId: string,
  input: { sourceCommandId: string },
  result: StartRuntimeHandlerThreadsResult,
) {
  return dedupeInvalidations([
    sessionNavigationInvalidation(workspaceId),
    commandInspectorInvalidation(workspaceId, input.sourceCommandId),
    ...result.threads.flatMap((thread) => [
      surfaceInvalidation(workspaceId, thread.surfacePiSessionId),
      handlerThreadInspectorInvalidation(workspaceId, thread.threadId),
    ]),
  ]);
}

export function runtimeThreadStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeThreadStatePortService {
  return {
    ensureHandlerThreadRunnable: (input) =>
      Effect.gen(function* () {
        const snapshot = yield* state.getSessionState(input.workspaceSessionId);
        const thread = getStructuredThread(snapshot, input.threadId);
        if (!thread || thread.surfacePiSessionId !== input.surfacePiSessionId) {
          return yield* Effect.fail(
            new StateContractError({
              operation: "runtime-thread.ensure-handler-runnable",
              reason: "not-found",
              message: `Handler thread ${input.threadId} was not found for surface ${input.surfacePiSessionId}.`,
            }),
          );
        }

        if (thread.status === "running-handler" && thread.wait === null) {
          return mutationResult(undefined);
        }

        yield* state.updateThread({
          threadId: input.threadId,
          status: "running-handler",
          wait: null,
        });
        return mutationResult(
          undefined,
          handlerThreadInvalidations(state.workspaceId, input.surfacePiSessionId, input.threadId),
        );
      }),
    startHandlerThreads: (input) =>
      state.startHandlerThreads(input as unknown as StructuredStartRuntimeHandlerThreadsInput).pipe(
        Effect.map((result) => {
          const mapped = mapStartHandlerThreadsResult(result);
          return mutationResult(
            mapped,
            result.committed
              ? startHandlerThreadsInvalidations(state.workspaceId, input, mapped)
              : [],
          );
        }),
      ),
  };
}

export function runtimeThreadStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeThreadStatePortService {
  return runtimeThreadStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeThreadStatePort = Effect.fn("@svvy/state/makeRuntimeThreadStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeThreadStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeThreadStatePort = Layer.effect(
  RuntimeThreadStatePort,
  makeRuntimeThreadStatePort(),
);
