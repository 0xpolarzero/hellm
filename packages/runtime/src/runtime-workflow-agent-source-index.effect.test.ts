import { assert, describe, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import {
  RuntimeContractError,
  RuntimeSourceStatePort,
  type AbsolutePath,
  type ReconcileRuntimeWorkflowAgentSourcesInput,
  type RuntimeSourceScanFactRecord,
  type RuntimeSourceStatePortService,
  type StateInvalidationDescriptor,
  type WorkflowAgentSourceObservation,
} from "@svvy/core";
import { Extensions, type ExtensionsService } from "@svvy/extensions";
import { RuntimeEventBus } from "./runtime-event-bus";
import {
  RuntimeLayerModelResolverPort,
  RuntimeLayerProviderAuthPort,
} from "./runtime-layer-provider-ports";
import { makeRuntimeWorkflowAgentSourceIndex } from "./runtime-workflow-agent-source-index";

const agentsInvalidation = {
  scope: "app",
  invalidation: { model: "agents" },
} satisfies StateInvalidationDescriptor;

describe("runtime workflow-agent source index", () => {
  it.effect(
    "admits each structural observation independently and fingerprints sorted evidence without timestamps",
    () => {
      const batches: ReconcileRuntimeWorkflowAgentSourcesInput[] = [];
      const published: StateInvalidationDescriptor[][] = [];
      let scan = 0;
      const extensions = Extensions.of({
        sources: {
          scanWorkflowAgents: () =>
            Effect.sync(() => {
              scan += 1;
              const observedAt = (
                scan === 1 ? "2026-07-11T09:00:00.000Z" : "2026-07-11T10:00:00.000Z"
              ) as WorkflowAgentSourceObservation["observedAt"];
              const observations = [
                validObservation({
                  sourceId: "validAgent",
                  provider: "openai",
                  model: "gpt-5.4",
                  reasoning: "high",
                  observedAt,
                }),
                validObservation({
                  sourceId: "missingModelAgent",
                  provider: "openai",
                  model: "missing-model",
                  reasoning: "high",
                  observedAt,
                }),
                validObservation({
                  sourceId: "missingAuthAgent",
                  provider: "anthropic",
                  model: "claude-sonnet-4-6",
                  reasoning: "high",
                  observedAt,
                }),
                validObservation({
                  sourceId: "badReasoningAgent",
                  provider: "openai",
                  model: "gpt-5.4",
                  reasoning: "xhigh",
                  observedAt,
                }),
                invalidObservation("unreadableAgent", observedAt),
              ];
              return scan === 1 ? observations.toReversed() : observations;
            }),
          scaffoldMissingWorkflowAgents: () => Effect.die("unused"),
        },
      } as unknown as ExtensionsService);

      return Effect.gen(function* () {
        const index = yield* makeRuntimeWorkflowAgentSourceIndex();
        const first = yield* index.reconcile;
        const second = yield* index.reconcile;

        assert.strictEqual(first.sourceFingerprint, second.sourceFingerprint);
        assert.deepStrictEqual(
          first.observations.map((observation) => observation.sourceId),
          [
            "badReasoningAgent",
            "missingAuthAgent",
            "missingModelAgent",
            "unreadableAgent",
            "validAgent",
          ],
        );
        assert.deepStrictEqual(
          Object.fromEntries(
            first.observations.map((observation) => [
              observation.sourceId,
              {
                status: observation.validationStatus,
                code: observation.diagnostics.at(-1)?.code ?? null,
              },
            ]),
          ),
          {
            badReasoningAgent: {
              status: "invalid",
              code: "workflow_agent_reasoning_unsupported",
            },
            missingAuthAgent: {
              status: "invalid",
              code: "workflow_agent_provider_auth_unavailable",
            },
            missingModelAgent: {
              status: "invalid",
              code: "workflow_agent_model_unavailable",
            },
            unreadableAgent: {
              status: "invalid",
              code: "workflow_agent_source_unreadable",
            },
            validAgent: { status: "valid", code: null },
          },
        );
        assert.strictEqual(batches.length, 2);
        assert.deepStrictEqual(published, [[agentsInvalidation], [agentsInvalidation]]);
      }).pipe(
        Effect.provideService(Extensions, extensions),
        Effect.provideService(RuntimeSourceStatePort, sourceStatePort(batches)),
        Effect.provideService(RuntimeLayerModelResolverPort, {
          resolveModel: (input) =>
            input.model === "missing-model"
              ? Effect.fail(
                  new RuntimeContractError({
                    operation: "test.model.resolve",
                    reason: "invalid-input",
                    message: "Missing model.",
                  }),
                )
              : Effect.succeed({
                  ...input,
                  supportedReasoning: ["off", "low", "medium", "high"],
                }),
        }),
        Effect.provideService(RuntimeLayerProviderAuthPort, {
          ensureUsableProviderAuth: (provider) =>
            Effect.succeed(provider === "anthropic" ? undefined : "test-api-key"),
          getProviderAuthUnavailableMessage: (provider) => `${provider} auth unavailable.`,
        }),
        Effect.provideService(
          RuntimeEventBus,
          RuntimeEventBus.of({
            publishLive: () => Effect.die("unused"),
            publishStateInvalidations: ({ afterCommit }) =>
              Effect.sync(() => {
                published.push([...afterCommit]);
                return [];
              }),
            subscribe: () => Effect.die("unused"),
          }),
        ),
        Effect.provideService(
          Crypto.Crypto,
          Crypto.make({
            randomBytes: (size) => new Uint8Array(size),
            digest: (_algorithm, data) => Effect.succeed(data),
          }),
        ),
      );
    },
  );

  it.effect("scaffolds before the startup scan, commit, and publication", () => {
    const actions: string[] = [];
    const observedAt = "2026-07-11T09:00:00.000Z" as WorkflowAgentSourceObservation["observedAt"];
    return Effect.gen(function* () {
      const index = yield* makeRuntimeWorkflowAgentSourceIndex();
      yield* index.scaffoldAndReconcile;
      assert.deepStrictEqual(actions, ["scaffold", "scan", "commit", "publish"]);
    }).pipe(
      Effect.provideService(
        Extensions,
        Extensions.of({
          sources: {
            scaffoldMissingWorkflowAgents: () =>
              Effect.sync(() => {
                actions.push("scaffold");
                return { created: [], preserved: [] };
              }),
            scanWorkflowAgents: () =>
              Effect.sync(() => {
                actions.push("scan");
                return [
                  validObservation({
                    sourceId: "validAgent",
                    provider: "openai",
                    model: "gpt-5.4",
                    reasoning: "high",
                    observedAt,
                  }),
                ];
              }),
          },
        } as unknown as ExtensionsService),
      ),
      Effect.provideService(
        RuntimeSourceStatePort,
        sourceStatePort([], () => actions.push("commit")),
      ),
      Effect.provideService(RuntimeLayerModelResolverPort, {
        resolveModel: (input) =>
          Effect.succeed({
            ...input,
            supportedReasoning: ["off", "low", "medium", "high"],
          }),
      }),
      Effect.provideService(RuntimeLayerProviderAuthPort, {
        ensureUsableProviderAuth: () => Effect.succeed("test-api-key"),
        getProviderAuthUnavailableMessage: () => "auth unavailable",
      }),
      Effect.provideService(
        RuntimeEventBus,
        RuntimeEventBus.of({
          publishLive: () => Effect.die("unused"),
          publishStateInvalidations: () =>
            Effect.sync(() => {
              actions.push("publish");
              return [];
            }),
          subscribe: () => Effect.die("unused"),
        }),
      ),
      Effect.provideService(
        Crypto.Crypto,
        Crypto.make({
          randomBytes: (size) => new Uint8Array(size),
          digest: (_algorithm, data) => Effect.succeed(data),
        }),
      ),
    );
  });
});

function sourceStatePort(
  batches: ReconcileRuntimeWorkflowAgentSourcesInput[],
  onReconcile?: () => void,
): RuntimeSourceStatePortService {
  return {
    readSourceVersion: () => Effect.die("unused"),
    recordSourceSave: () => Effect.die("unused"),
    recordSourceDelete: () => Effect.die("unused"),
    recordWorkflowAgentSourceSave: () => Effect.die("unused"),
    recordWorkflowAgentSourceDelete: () => Effect.die("unused"),
    reconcileWorkflowAgentSources: (input) =>
      Effect.sync(() => {
        batches.push(input);
        onReconcile?.();
        return {
          value: sourceScanFact(input),
          afterCommit: [agentsInvalidation],
        };
      }),
    recordSourceScan: () => Effect.die("unused"),
    reconcileDiscoveredHostSnippets: () => Effect.die("unused"),
    recordObservedSourceDeletion: () => Effect.die("unused"),
    recordSourceDiagnostic: () => Effect.die("unused"),
  };
}

function sourceScanFact(
  input: ReconcileRuntimeWorkflowAgentSourcesInput,
): RuntimeSourceScanFactRecord {
  return {
    scope: { kind: "app-global" },
    scopeKey: "app-global",
    domain: "workflows",
    sourceFingerprint: input.sourceFingerprint,
    diagnostics: input.diagnostics,
    lastObservedPath: null,
    lastObservationKind: "scan",
    observedAt: input.scannedAt,
    createdAt: input.scannedAt,
    updatedAt: input.scannedAt,
  };
}

function validObservation(input: {
  readonly sourceId: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: "high" | "xhigh";
  readonly observedAt: WorkflowAgentSourceObservation["observedAt"];
}): WorkflowAgentSourceObservation {
  const path = `/tmp/svvy/workflows/agents/${input.sourceId}.agent.json` as AbsolutePath;
  return {
    sourceId: input.sourceId,
    path,
    sourceVersion: `version:${input.sourceId}`,
    fingerprint: `fingerprint:${input.sourceId}`,
    validationStatus: "valid",
    diagnostics: [],
    parameters: {
      id: input.sourceId,
      label: input.sourceId,
      provider: input.provider,
      model: input.model,
      reasoning: { effort: input.reasoning },
      instructions: "Test agent.",
    },
    extensionOrder: [],
    observedAt: input.observedAt,
  };
}

function invalidObservation(
  sourceId: string,
  observedAt: WorkflowAgentSourceObservation["observedAt"],
): WorkflowAgentSourceObservation {
  const path = `/tmp/svvy/workflows/agents/${sourceId}.agent.json` as AbsolutePath;
  return {
    sourceId,
    path,
    sourceVersion: `unreadable:${sourceId}`,
    fingerprint: `unreadable:${sourceId}`,
    validationStatus: "invalid",
    diagnostics: [
      {
        severity: "error",
        code: "workflow_agent_source_unreadable",
        message: `Workflow-agent source is unreadable: ${sourceId}`,
        path,
      },
    ],
    parameters: null,
    extensionOrder: [],
    observedAt,
  };
}
