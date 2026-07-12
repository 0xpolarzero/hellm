import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  type ExtensionError,
  type ReconcileRuntimeWorkflowAgentSourcesInput,
  RuntimeContractError,
  RuntimeSourceStatePort,
  type RuntimeSourceRootFingerprintInput,
  type SourceDiagnostic,
  type StateContractError,
  type TaskAgentParametersSource,
  type WorkflowAgentSourceObservation,
} from "@svvy/core";
import { Extensions } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeLayerModelResolverPort,
  type RuntimeLayerModelResolverPortService,
  RuntimeLayerProviderAuthPort,
  type RuntimeLayerProviderAuthPortService,
} from "./runtime-layer-provider-ports";

export interface RuntimeWorkflowAgentSourceIndexReconcileResult {
  readonly sourceFingerprint: string;
  readonly sourceRoots?: readonly RuntimeSourceRootFingerprintInput[];
  readonly observations: readonly WorkflowAgentSourceObservation[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly scannedAt: ReconcileRuntimeWorkflowAgentSourcesInput["scannedAt"];
}

export interface RuntimeWorkflowAgentSourceIndexService {
  readonly scaffoldAndReconcile: Effect.Effect<
    RuntimeWorkflowAgentSourceIndexReconcileResult,
    RuntimeContractError
  >;
  readonly reconcile: Effect.Effect<
    RuntimeWorkflowAgentSourceIndexReconcileResult,
    RuntimeContractError
  >;
}

export class RuntimeWorkflowAgentSourceIndex extends Context.Service<
  RuntimeWorkflowAgentSourceIndex,
  RuntimeWorkflowAgentSourceIndexService
>()("@svvy/runtime/RuntimeWorkflowAgentSourceIndex") {}

interface WorkflowAgentAdmissionFailure {
  readonly code:
    | "workflow_agent_model_unavailable"
    | "workflow_agent_provider_auth_unavailable"
    | "workflow_agent_reasoning_unsupported";
  readonly error: RuntimeContractError;
}

export function admitRuntimeWorkflowAgentModel(input: {
  readonly operation: string;
  readonly agent: Pick<TaskAgentParametersSource, "provider" | "model" | "reasoning">;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly providerAuth: RuntimeLayerProviderAuthPortService;
}): Effect.Effect<void, RuntimeContractError> {
  return admitRuntimeWorkflowAgentModelWithDiagnostic(input).pipe(
    Effect.mapError((failure) => failure.error),
  );
}

export const makeRuntimeWorkflowAgentSourceIndex = Effect.fn(
  "@svvy/runtime/makeRuntimeWorkflowAgentSourceIndex",
)(function* () {
  const extensions = yield* Extensions;
  const sourceState = yield* RuntimeSourceStatePort;
  const modelResolver = yield* RuntimeLayerModelResolverPort;
  const providerAuth = yield* RuntimeLayerProviderAuthPort;
  const eventBus = yield* RuntimeEventBus;
  const crypto = yield* Crypto.Crypto;

  const reconcile = Effect.gen(function* () {
    const scanned = yield* extensions.sources
      .scanWorkflowAgents()
      .pipe(
        Effect.mapError((cause) =>
          runtimeWorkflowAgentExtensionError("runtime.workflowAgentSources.scan", cause),
        ),
      );
    const scannedAt = yield* workflowAgentScanTimestamp(scanned);
    const observations = yield* Effect.forEach(scanned, (observation) =>
      admitWorkflowAgentSourceObservation({
        observation,
        modelResolver,
        providerAuth,
      }),
    );
    const diagnostics: readonly SourceDiagnostic[] = [];
    const sortedObservations = [...observations].toSorted(compareWorkflowAgentObservations);
    const sourceFingerprint = yield* workflowAgentSourceFingerprint({
      observations: sortedObservations,
      diagnostics,
      crypto,
    });
    const batch: ReconcileRuntimeWorkflowAgentSourcesInput = {
      sourceFingerprint,
      observations: sortedObservations,
      diagnostics,
      scannedAt,
    };
    const mutation = yield* sourceState
      .reconcileWorkflowAgentSources(batch)
      .pipe(
        Effect.mapError((cause) =>
          runtimeWorkflowAgentStateError("runtime.workflowAgentSources.reconcile", cause),
        ),
      );
    yield* eventBus.publishStateInvalidations({ afterCommit: mutation.afterCommit }).pipe(
      Effect.mapError(
        (cause) =>
          new RuntimeContractError({
            operation: "runtime.workflowAgentSources.publish",
            reason: "state-conflict",
            message:
              cause instanceof Error
                ? cause.message
                : "Workflow-agent source reconciliation publication failed.",
            cause,
          }),
      ),
      Effect.asVoid,
    );
    return batch;
  });

  return RuntimeWorkflowAgentSourceIndex.of({
    reconcile,
    scaffoldAndReconcile: extensions.sources.scaffoldMissingWorkflowAgents().pipe(
      Effect.mapError((cause) =>
        runtimeWorkflowAgentExtensionError("runtime.workflowAgentSources.scaffold", cause),
      ),
      Effect.andThen(reconcile),
    ),
  });
});

export const layerRuntimeWorkflowAgentSourceIndex = Layer.effect(
  RuntimeWorkflowAgentSourceIndex,
  makeRuntimeWorkflowAgentSourceIndex(),
);

function admitWorkflowAgentSourceObservation(input: {
  readonly observation: WorkflowAgentSourceObservation;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly providerAuth: RuntimeLayerProviderAuthPortService;
}): Effect.Effect<WorkflowAgentSourceObservation> {
  if (input.observation.validationStatus === "invalid") {
    return Effect.succeed(input.observation);
  }
  const parameters = input.observation.parameters;
  if (parameters === null) {
    return Effect.succeed({
      ...input.observation,
      validationStatus: "invalid",
      diagnostics: [
        ...input.observation.diagnostics,
        {
          severity: "error",
          code: "workflow_agent_model_unavailable",
          message: `Workflow-agent source ${input.observation.sourceId} has no admitted parameters.`,
          path: input.observation.path,
        },
      ],
      parameters: null,
    });
  }
  return admitRuntimeWorkflowAgentModelWithDiagnostic({
    operation: "runtime.workflowAgentSources.admit",
    agent: parameters,
    modelResolver: input.modelResolver,
    providerAuth: input.providerAuth,
  }).pipe(
    Effect.as(input.observation),
    Effect.catch((failure) =>
      Effect.succeed({
        ...input.observation,
        validationStatus: "invalid" as const,
        diagnostics: [
          ...input.observation.diagnostics,
          {
            severity: "error" as const,
            code: failure.code,
            message: failure.error.message,
            path: input.observation.path,
          },
        ],
        parameters: null,
      }),
    ),
  );
}

function admitRuntimeWorkflowAgentModelWithDiagnostic(input: {
  readonly operation: string;
  readonly agent: Pick<TaskAgentParametersSource, "provider" | "model" | "reasoning">;
  readonly modelResolver: RuntimeLayerModelResolverPortService;
  readonly providerAuth: RuntimeLayerProviderAuthPortService;
}): Effect.Effect<void, WorkflowAgentAdmissionFailure> {
  return Effect.gen(function* () {
    const resolved = yield* input.modelResolver
      .resolveModel({
        provider: input.agent.provider,
        model: input.agent.model,
      })
      .pipe(
        Effect.mapError((cause) =>
          workflowAgentAdmissionFailure({
            code: "workflow_agent_model_unavailable",
            operation: input.operation,
            reason: "invalid-input",
            message: `Workflow-agent source references unavailable model ${input.agent.provider}/${input.agent.model}.`,
            cause,
          }),
        ),
      );
    if (resolved.provider !== input.agent.provider || resolved.model !== input.agent.model) {
      return yield* Effect.fail(
        workflowAgentAdmissionFailure({
          code: "workflow_agent_model_unavailable",
          operation: input.operation,
          reason: "invalid-input",
          message: `Workflow-agent source model resolution did not exactly match ${input.agent.provider}/${input.agent.model}.`,
        }),
      );
    }
    const apiKey = yield* input.providerAuth.ensureUsableProviderAuth(input.agent.provider).pipe(
      Effect.mapError((cause) =>
        workflowAgentAdmissionFailure({
          code: "workflow_agent_provider_auth_unavailable",
          operation: input.operation,
          reason: "dependency-not-ready",
          message: `Workflow-agent source references unauthenticated provider ${input.agent.provider}.`,
          cause,
        }),
      ),
    );
    if (!apiKey) {
      return yield* Effect.fail(
        workflowAgentAdmissionFailure({
          code: "workflow_agent_provider_auth_unavailable",
          operation: input.operation,
          reason: "dependency-not-ready",
          message: input.providerAuth.getProviderAuthUnavailableMessage(input.agent.provider),
        }),
      );
    }
    if (!resolved.supportedReasoning.includes(input.agent.reasoning.effort)) {
      return yield* Effect.fail(
        workflowAgentAdmissionFailure({
          code: "workflow_agent_reasoning_unsupported",
          operation: input.operation,
          reason: "invalid-input",
          message: `Workflow-agent source references unsupported reasoning ${input.agent.reasoning.effort} for ${input.agent.provider}/${input.agent.model}.`,
        }),
      );
    }
  });
}

function workflowAgentAdmissionFailure(input: {
  readonly code: WorkflowAgentAdmissionFailure["code"];
  readonly operation: string;
  readonly reason: "invalid-input" | "dependency-not-ready";
  readonly message: string;
  readonly cause?: unknown;
}): WorkflowAgentAdmissionFailure {
  return {
    code: input.code,
    error: new RuntimeContractError({
      operation: input.operation,
      reason: input.reason,
      message: input.message,
      ...(input.cause === undefined ? {} : { cause: input.cause }),
    }),
  };
}

function workflowAgentScanTimestamp(
  observations: readonly WorkflowAgentSourceObservation[],
): Effect.Effect<ReconcileRuntimeWorkflowAgentSourcesInput["scannedAt"], RuntimeContractError> {
  const scannedAt = observations[0]?.observedAt;
  if (scannedAt) {
    if (observations.some((observation) => observation.observedAt !== scannedAt)) {
      return Effect.fail(
        new RuntimeContractError({
          operation: "runtime.workflowAgentSources.scan",
          reason: "schema-error",
          message: "Workflow-agent source scan observations must share one scan timestamp.",
        }),
      );
    }
    return Effect.succeed(scannedAt);
  }
  return DateTime.now.pipe(
    Effect.map(
      (now) => DateTime.formatIso(now) as ReconcileRuntimeWorkflowAgentSourcesInput["scannedAt"],
    ),
  );
}

function workflowAgentSourceFingerprint(input: {
  readonly sourceRoots?: readonly RuntimeSourceRootFingerprintInput[];
  readonly observations: readonly WorkflowAgentSourceObservation[];
  readonly diagnostics: readonly SourceDiagnostic[];
  readonly crypto: Crypto.Crypto;
}): Effect.Effect<string, RuntimeContractError> {
  const evidence = canonicalJson({
    ...(input.sourceRoots === undefined
      ? {}
      : {
          sourceRoots: [...input.sourceRoots].toSorted((left, right) =>
            compareText(
              `${left.sourceRoot}\u0000${left.rootFingerprint}`,
              `${right.sourceRoot}\u0000${right.rootFingerprint}`,
            ),
          ),
        }),
    observations: [...input.observations]
      .toSorted(compareWorkflowAgentObservations)
      .map(({ observedAt: _observedAt, diagnostics, ...observation }) => ({
        ...observation,
        diagnostics: [...diagnostics].toSorted(compareDiagnostics),
      })),
    diagnostics: [...input.diagnostics].toSorted(compareDiagnostics),
  });
  return input.crypto.digest("SHA-256", new TextEncoder().encode(JSON.stringify(evidence))).pipe(
    Effect.map(
      (digest) =>
        `sha256:${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
    ),
    Effect.mapError(
      (cause) =>
        new RuntimeContractError({
          operation: "runtime.workflowAgentSources.fingerprint",
          reason: "state-conflict",
          message: "Workflow-agent source reconciliation evidence could not be fingerprinted.",
          cause,
        }),
    ),
  );
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function compareWorkflowAgentObservations(
  left: WorkflowAgentSourceObservation,
  right: WorkflowAgentSourceObservation,
): number {
  return compareText(`${left.sourceId}\u0000${left.path}`, `${right.sourceId}\u0000${right.path}`);
}

function compareDiagnostics(left: SourceDiagnostic, right: SourceDiagnostic): number {
  return compareText(JSON.stringify(canonicalJson(left)), JSON.stringify(canonicalJson(right)));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function runtimeWorkflowAgentExtensionError(
  operation: string,
  cause: ExtensionError,
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason:
      cause.reason === "invalid-input"
        ? "invalid-input"
        : cause.reason === "not-found" || cause.reason === "dependency-not-ready"
          ? "dependency-not-ready"
          : "state-conflict",
    message: cause.message,
    cause,
  });
}

function runtimeWorkflowAgentStateError(
  operation: string,
  cause: StateContractError,
): RuntimeContractError {
  return new RuntimeContractError({
    operation,
    reason: cause.reason === "invalid-input" ? "invalid-input" : "state-conflict",
    message: cause.message,
    cause,
  });
}
