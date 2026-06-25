import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeApprovalStatePort,
  type RuntimeApprovalRecord,
  type RuntimeApprovalStatePortService,
} from "@svvy/core";
import {
  commandInspectorInvalidation,
  dedupeInvalidations,
  mutationResult,
  runtimeApprovalInvalidation,
  surfaceAndSessionNavigationInvalidations,
} from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredRuntimeApprovalRequestRecord,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function mapRuntimeApprovalRecord(
  record: StructuredRuntimeApprovalRequestRecord,
): RuntimeApprovalRecord {
  return record as RuntimeApprovalRecord;
}

function runtimeApprovalInvalidations(
  workspaceId: string,
  record: RuntimeApprovalRecord,
): ReturnType<typeof dedupeInvalidations> {
  return dedupeInvalidations([
    runtimeApprovalInvalidation(workspaceId, record.requestId),
    ...surfaceAndSessionNavigationInvalidations(workspaceId, record.surfacePiSessionId),
    ...(record.commandId ? [commandInspectorInvalidation(workspaceId, record.commandId)] : []),
  ]);
}

export function runtimeApprovalStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeApprovalStatePortService {
  return {
    createApprovalRequest: (input) =>
      state.createRuntimeApprovalRequest(input).pipe(
        Effect.map(mapRuntimeApprovalRecord),
        Effect.map((record) =>
          mutationResult(record, runtimeApprovalInvalidations(state.workspaceId, record)),
        ),
      ),
    resolveApprovalRequest: (input) =>
      state.resolveRuntimeApprovalRequest(input).pipe(
        Effect.map(mapRuntimeApprovalRecord),
        Effect.map((record) =>
          mutationResult(record, runtimeApprovalInvalidations(state.workspaceId, record)),
        ),
      ),
    getApprovalRequest: (input) =>
      state.getRuntimeApprovalRequest(input.requestId).pipe(Effect.map(mapRuntimeApprovalRecord)),
    listOpenApprovalRequests: (input) =>
      state
        .listOpenRuntimeApprovalRequests()
        .pipe(
          Effect.map((records) =>
            records
              .filter(
                (record) =>
                  !input?.surfacePiSessionId ||
                  record.surfacePiSessionId === input.surfacePiSessionId,
              )
              .map(mapRuntimeApprovalRecord),
          ),
        ),
  };
}

export function runtimeApprovalStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeApprovalStatePortService {
  return runtimeApprovalStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeApprovalStatePort = Effect.fn("@svvy/state/makeRuntimeApprovalStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeApprovalStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeApprovalStatePort = Layer.effect(
  RuntimeApprovalStatePort,
  makeRuntimeApprovalStatePort(),
);
