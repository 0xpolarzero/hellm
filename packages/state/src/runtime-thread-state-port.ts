import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeThreadStatePort,
  type QueueItemId,
  type RuntimeThreadStatePortService,
  type StartRuntimeHandlerThreadsResult,
  type SurfacePiSessionId,
  type ThreadGroupId,
  type ThreadId,
  type WorktreeId,
  type WorkspaceSessionId,
} from "@svvy/core";
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
      parentThreadId: (thread.parentThreadId ?? null) as ThreadId | null,
      title: thread.title,
      objective: thread.objective,
      historyMode: thread.historyMode,
      objectiveState: "active",
      status: "running-handler",
      wait: null,
      worktreeId: (thread.worktree ?? null) as WorktreeId | null,
      generatedAgentContextFingerprint:
        generatedAgentContextBinding.generatedAgentContextFingerprint,
      generatedAgentContextBindingId: generatedAgentContextBinding.id,
      queuedMessageId: queuedMessage.id as QueueItemId,
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
      state
        .ensureHandlerThreadRunnable(input)
        .pipe(
          Effect.map((result) =>
            mutationResult(
              undefined,
              result.committed
                ? handlerThreadInvalidations(
                    state.workspaceId,
                    result.thread.surfacePiSessionId,
                    result.thread.id,
                  )
                : [],
            ),
          ),
        ),
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
