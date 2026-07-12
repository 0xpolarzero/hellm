import type { StateInvalidationDescriptor, StateMutationResult } from "@svvy/core";
import type {
  StructuredPiSessionRecord,
  StructuredSessionStateStore,
  StructuredThreadRecord,
} from "./structured-session-state";
import {
  commandInspectorInvalidation,
  dedupeInvalidations,
  handlerThreadInspectorInvalidation,
  mutationResult,
  requestInputInvalidation,
  runtimeApprovalInvalidation,
  sessionNavigationInvalidation,
  surfaceAndSessionNavigationInvalidations,
  surfaceInvalidation,
  workflowTaskAttemptInspectorInvalidation,
} from "./state-mutation-result";

function threadInvalidations(
  workspaceId: string,
  thread: Pick<StructuredThreadRecord, "id" | "surfacePiSessionId">,
): readonly StateInvalidationDescriptor[] {
  return dedupeInvalidations([
    surfaceInvalidation(workspaceId, thread.surfacePiSessionId),
    handlerThreadInspectorInvalidation(workspaceId, thread.id),
    sessionNavigationInvalidation(workspaceId),
  ]);
}

/**
 * Restricted app-bootstrap adapter for catalog-owned structured-session writes.
 *
 * It does not publish. Each method returns descriptors only after the concrete store method has
 * committed successfully so the runtime-owned publication boundary can preserve commit ordering.
 */
export function structuredSessionCatalogMutationsFromStore(store: StructuredSessionStateStore) {
  const workspaceId = store.workspaceId;

  return {
    upsertPiSession(
      input: StructuredPiSessionRecord,
    ): StateMutationResult<StructuredPiSessionRecord | null> {
      const wasDeleted = store.isSessionDeleted(input.sessionId);
      store.upsertPiSession(input);
      if (wasDeleted) {
        return mutationResult(null);
      }
      const value = store.getSessionState(input.sessionId).pi;
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    updateOrchestratorPromptDefaults(input: {
      sessionId: string;
      provider: string;
      model: string;
      reasoningEffort: string;
    }): StateMutationResult<StructuredPiSessionRecord> {
      const current = store.getSessionState(input.sessionId).pi;
      store.upsertPiSession({
        ...current,
        provider: input.provider,
        model: input.model,
        reasoningEffort: input.reasoningEffort,
        updatedAt: store.getCurrentTimestamp(),
      });
      const value = store.getSessionState(input.sessionId).pi;
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    setOrchestratorGeneratedAgentContextFingerprint(input: {
      sessionId: string;
      generatedAgentContextFingerprint: string;
    }): StateMutationResult<StructuredPiSessionRecord> {
      const current = store.getSessionState(input.sessionId).pi;
      store.upsertPiSession({
        ...current,
        generatedAgentContextFingerprint: input.generatedAgentContextFingerprint,
        updatedAt: store.getCurrentTimestamp(),
      });
      const value = store.getSessionState(input.sessionId).pi;
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    deleteSessionState(sessionId: string): StateMutationResult<void> {
      const snapshot = store.getSessionState(sessionId);
      const descriptors = dedupeInvalidations([
        sessionNavigationInvalidation(workspaceId),
        surfaceInvalidation(workspaceId, snapshot.session.orchestratorPiSessionId),
        ...snapshot.threads.flatMap((thread) => [
          surfaceInvalidation(workspaceId, thread.surfacePiSessionId),
          handlerThreadInspectorInvalidation(workspaceId, thread.id),
        ]),
        ...snapshot.workflowTaskAttempts.flatMap((attempt) => [
          ...(attempt.surfacePiSessionId
            ? [surfaceInvalidation(workspaceId, attempt.surfacePiSessionId)]
            : []),
          workflowTaskAttemptInspectorInvalidation(workspaceId, attempt.id),
        ]),
        ...snapshot.commands.map((command) =>
          commandInspectorInvalidation(workspaceId, command.id),
        ),
        ...snapshot.requestUserInputRequests.map((request) =>
          requestInputInvalidation(workspaceId, request.requestId),
        ),
        ...(snapshot.runtimeApprovalRequests ?? []).map((request) =>
          runtimeApprovalInvalidation(workspaceId, request.requestId),
        ),
      ]);
      store.deleteSessionState(sessionId);
      return mutationResult(undefined, descriptors);
    },

    markManualTitleOverride(input: {
      sessionId: string;
      title: string;
    }): StateMutationResult<StructuredPiSessionRecord> {
      const value = store.markManualTitleOverride(input);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    setComposerDraft(
      input: Parameters<StructuredSessionStateStore["setComposerDraft"]>[0],
    ): StateMutationResult<ReturnType<StructuredSessionStateStore["setComposerDraft"]>> {
      const value = store.setComposerDraft(input);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, input.surfacePiSessionId),
      );
    },

    setSessionExtensionContextAutoUpdate(
      input: Parameters<StructuredSessionStateStore["setSessionExtensionContextAutoUpdate"]>[0],
    ): StateMutationResult<StructuredPiSessionRecord> {
      const value = store.setSessionExtensionContextAutoUpdate(input);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    setThreadExtensionContextAutoUpdate(
      input: Parameters<StructuredSessionStateStore["setThreadExtensionContextAutoUpdate"]>[0],
    ): StateMutationResult<StructuredThreadRecord> {
      const value = store.setThreadExtensionContextAutoUpdate(input);
      return mutationResult(value, threadInvalidations(workspaceId, value));
    },

    updateThreadSurfaceMetadata(
      input: Pick<
        Parameters<StructuredSessionStateStore["updateThread"]>[0],
        | "threadId"
        | "agentProfileJson"
        | "loadedExtensionIds"
        | "availableExtensionIds"
        | "generatedAgentContextFingerprint"
      >,
    ): StateMutationResult<StructuredThreadRecord> {
      const value = store.updateThread(input);
      return mutationResult(value, threadInvalidations(workspaceId, value));
    },

    cancelSurfaceMessage(
      input: Parameters<StructuredSessionStateStore["cancelSurfaceMessage"]>[0],
    ): StateMutationResult<ReturnType<StructuredSessionStateStore["cancelSurfaceMessage"]>> {
      const value = store.cancelSurfaceMessage(input);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.surfacePiSessionId),
      );
    },

    reorderSurfaceMessage(
      input: Parameters<StructuredSessionStateStore["reorderSurfaceMessage"]>[0],
    ): StateMutationResult<ReturnType<StructuredSessionStateStore["reorderSurfaceMessage"]>> {
      const before = store
        .listQueuedSurfaceMessages({ surfacePiSessionId: input.surfacePiSessionId })
        .map((row) => [row.id, row.position] as const);
      const value = store.reorderSurfaceMessage(input);
      const after = value.map((row) => [row.id, row.position] as const);
      const changed =
        before.length !== after.length ||
        before.some(([id, position], index) => {
          const next = after[index];
          return next?.[0] !== id || next[1] !== position;
        });
      return mutationResult(
        value,
        changed
          ? surfaceAndSessionNavigationInvalidations(workspaceId, input.surfacePiSessionId)
          : [],
      );
    },

    markTitleGenerationRunning(sessionId: string): StateMutationResult<StructuredPiSessionRecord> {
      const value = store.markTitleGenerationRunning(sessionId);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    completeTitleGeneration(input: {
      sessionId: string;
      title: string;
    }): StateMutationResult<StructuredPiSessionRecord> {
      const value = store.completeTitleGeneration(input);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    failTitleGeneration(input: {
      sessionId: string;
      error: string;
    }): StateMutationResult<StructuredPiSessionRecord> {
      const value = store.failTitleGeneration(input);
      return mutationResult(
        value,
        surfaceAndSessionNavigationInvalidations(workspaceId, value.sessionId),
      );
    },

    completeThreadTitle(input: {
      threadId: string;
      title: string;
    }): StateMutationResult<StructuredThreadRecord> {
      const value = store.updateThread(input);
      return mutationResult(value, threadInvalidations(workspaceId, value));
    },
  };
}
