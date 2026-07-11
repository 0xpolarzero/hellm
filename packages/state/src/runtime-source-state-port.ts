import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeSourceStatePort,
  type RuntimeSourceFactRecord,
  type RuntimeSourceScanFactRecord,
  type RuntimeSourceStatePortService,
  type SourceDomain,
  type StateInvalidationDescriptor,
} from "@svvy/core";
import { dedupeInvalidations, mutationResult } from "./state-mutation-result";
import {
  StructuredSessionState,
  structuredSessionStateFromStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";

function sourceInvalidations(
  source: Pick<RuntimeSourceFactRecord, "scope" | "sourceKind">,
): readonly StateInvalidationDescriptor[] {
  switch (source.sourceKind) {
    case "builtin-extension":
    case "user-extension":
      return [{ scope: "app", invalidation: { model: "extensions" } }];
    case "workflow-agent":
      return dedupeInvalidations([
        { scope: "app", invalidation: { model: "agents" } },
        { scope: "app", invalidation: { model: "workflowsGenerated" } },
      ]);
    case "workflow-prompt":
    case "workflow-component":
    case "workflow-workflow":
      return [{ scope: "app", invalidation: { model: "workflowsGenerated" } }];
  }
}

function sourceScanInvalidations(
  source: Pick<RuntimeSourceScanFactRecord, "domain" | "scope">,
): readonly StateInvalidationDescriptor[] {
  switch (source.domain) {
    case "extensions":
      return [{ scope: "app", invalidation: { model: "extensions" } }];
    case "workflows":
      return [{ scope: "app", invalidation: { model: "workflowsGenerated" } }];
    case "external_instructions":
      return [];
    case "host_snippets":
      return source.scope.kind === "workspace"
        ? [
            {
              scope: "workspace",
              workspaceId: source.scope.workspaceId,
              invalidation: { model: "snippets" },
            },
          ]
        : [];
  }
}

function sourceDomainFallbackFingerprint(domain: SourceDomain): string {
  return `unresolved:${domain}`;
}

export function runtimeSourceStatePortFromStructuredSessionState(
  state: StructuredSessionState["Service"],
): RuntimeSourceStatePortService {
  return {
    readSourceVersion: state.readRuntimeSourceVersion,
    recordSourceSave: (input) =>
      state
        .recordRuntimeSourceSave(input)
        .pipe(Effect.map((record) => mutationResult(record, sourceInvalidations(record)))),
    recordSourceDelete: (input) =>
      state
        .recordRuntimeSourceDelete(input)
        .pipe(Effect.map((record) => mutationResult(record, sourceInvalidations(record)))),
    recordSourceScan: (input) =>
      state
        .recordRuntimeSourceScan(input)
        .pipe(Effect.map((record) => mutationResult(record, sourceScanInvalidations(record)))),
    reconcileDiscoveredHostSnippets: (input) =>
      state
        .reconcileDiscoveredHostSnippets(input)
        .pipe(Effect.map((record) => mutationResult(record, sourceScanInvalidations(record)))),
    recordObservedSourceDeletion: (input) =>
      state
        .recordObservedRuntimeSourceDeletion({
          ...input,
          sourceFingerprint:
            input.sourceFingerprint ?? sourceDomainFallbackFingerprint(input.domain),
        })
        .pipe(Effect.map((record) => mutationResult(record, sourceScanInvalidations(record)))),
    recordSourceDiagnostic: (input) =>
      state
        .recordRuntimeSourceDiagnostic({
          ...input,
          sourceFingerprint:
            input.sourceFingerprint ?? sourceDomainFallbackFingerprint(input.domain),
        })
        .pipe(Effect.map((record) => mutationResult(record, sourceScanInvalidations(record)))),
  };
}

export function runtimeSourceStatePortFromStore(
  store: StructuredSessionStateStore,
): RuntimeSourceStatePortService {
  return runtimeSourceStatePortFromStructuredSessionState(structuredSessionStateFromStore(store));
}

export const makeRuntimeSourceStatePort = Effect.fn("@svvy/state/makeRuntimeSourceStatePort")(
  function* () {
    const state = yield* StructuredSessionState;
    return runtimeSourceStatePortFromStructuredSessionState(state);
  },
);

export const layerRuntimeSourceStatePort = Layer.effect(
  RuntimeSourceStatePort,
  makeRuntimeSourceStatePort(),
);
