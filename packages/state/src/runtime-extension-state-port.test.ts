import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CommandId,
  ExtensionDependencyApprovalIdentity,
  ExtensionDependencyReadiness,
  ExtensionBuildAttemptId,
  ExtensionBuildId,
  ExtensionCurrentBuildManifest,
  ExtensionId,
  ExtensionRegistryObservationResult,
  ExtensionRegistryStateRecord,
  ExtensionSourceBuildObservation,
  ReconcileExtensionSourceBuildEvidenceInput,
  ReconcileExtensionDependencyReadinessInput,
  IsoDateTimeString,
  RuntimeClientRequestId,
} from "@svvy/core";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runtimeExtensionStatePortFromStore } from "./runtime-extension-state-port";
import { runTestEffect } from "./effect.test-support";

const commandId = (value: string): CommandId => value as CommandId;
const extensionId = (value: string): ExtensionId => value as ExtensionId;
const clientRequestId = (value: string): RuntimeClientRequestId => value as RuntimeClientRequestId;
const checkedAt = (value: string): NonNullable<ExtensionDependencyReadiness["checkedAt"]> =>
  value as NonNullable<ExtensionDependencyReadiness["checkedAt"]>;
const isoDateTime = (value: string): IsoDateTimeString => value as IsoDateTimeString;
const registryObservedAt = (value: string): ExtensionRegistryStateRecord["observedAt"] =>
  value as ExtensionRegistryStateRecord["observedAt"];
const dependencyRecordedAt = (
  value: string,
): ReconcileExtensionDependencyReadinessInput["recordedAt"] =>
  value as ReconcileExtensionDependencyReadinessInput["recordedAt"];
const extensionSourceFingerprint = (hex: string) =>
  `sha256:${hex.repeat(64)}` as NonNullable<ExtensionSourceBuildObservation["sourceFingerprint"]>;
const buildObservedAt = (value: string) =>
  value as ReconcileExtensionSourceBuildEvidenceInput["observedAt"];
const buildAttemptId = (hex: string) =>
  `extension-build-attempt:linear:${hex.repeat(64)}` as ExtensionBuildAttemptId;
const extensionBuildId = (hex: string) =>
  `extension-build:linear:${hex.repeat(64)}` as ExtensionBuildId;
const extensionBuildTime = (value: string) => value as ExtensionCurrentBuildManifest["builtAt"];
const currentBuildManifest = (
  sourceFingerprint: NonNullable<ExtensionSourceBuildObservation["sourceFingerprint"]>,
): ExtensionCurrentBuildManifest => ({
  schemaVersion: 1,
  buildId: extensionBuildId("d"),
  extensionId: extensionId("linear"),
  interfaceKind: "svvyx",
  sourceFingerprint,
  contextFingerprint:
    `sha256:${"e".repeat(64)}` as ExtensionCurrentBuildManifest["contextFingerprint"],
  outputFingerprint:
    `sha256:${"f".repeat(64)}` as ExtensionCurrentBuildManifest["outputFingerprint"],
  contextReady: true,
  generatedFiles: [],
  builtAt: extensionBuildTime("2026-04-18T09:00:02.000Z"),
});
const registryObservation = (
  aggregateFingerprint = "sha256:registry-v1",
): ExtensionRegistryObservationResult => ({
  aggregateFingerprint,
  observations: [
    {
      extensionId: extensionId("linear"),
      category: "user",
      interfaceKind: "svvyx",
      svvyxImplementation: {
        kind: "source-runtime",
        sourceRelativePath: "source/index.ts",
      },
      title: "Linear",
      description: "Manage Linear issues.",
      customized: true,
      usagePolicy: {
        canonicalOrder: 0,
        baselineUsage: {
          orchestrator: "loaded",
          handler: "unavailable",
          "workflow-task": "loaded",
        },
        networkAccess: "not-required",
        configurable: true,
        fixedReason: null,
      },
      buildRequirement: "required",
      materializationPlan: null,
      capabilities: {
        resettable: false,
        deletable: true,
        typescriptApiEnabled: true,
        materializationRequired: false,
      },
      contributors: [],
      tooling: [],
      cliDeclarations: [],
      envDeclarations: [
        {
          name: "LINEAR_TOKEN",
          required: true,
          secret: true,
          description: "Linear API token.",
          hasDefault: false,
        },
        {
          name: "LINEAR_HOST",
          required: false,
          secret: false,
          description: "Linear API host.",
          hasDefault: true,
        },
      ],
      dependencyDeclarations: [],
      sourceFingerprint: "sha256:linear-v1",
      diagnostics: [],
    },
  ],
  diagnostics: [],
});
const registryObservationWithCli = (
  aggregateFingerprint = "sha256:registry-cli-v1",
): ExtensionRegistryObservationResult => {
  const base = registryObservation(aggregateFingerprint);
  return {
    ...base,
    observations: base.observations.map((observation) => ({
      ...observation,
      cliDeclarations: [
        {
          id: "linear-cli",
          requirementFingerprint: "sha256:linear-cli-v1",
          binary: "linear",
          package: "@example/linear-cli",
          required: true,
          defaultVersion: "1.2.3",
          versionCommand: "linear --version",
          installCommand: "bun add -g @example/linear-cli@{{version}}",
          nodeRequirement: null,
        },
      ],
    })),
  };
};
const extensionDependencyApprovalIdentity = (
  input: Pick<ExtensionDependencyApprovalIdentity, "kind" | "name" | "version"> &
    Partial<Omit<ExtensionDependencyApprovalIdentity, "kind" | "name" | "version">>,
): ExtensionDependencyApprovalIdentity => ({
  kind: input.kind,
  packageManager: input.packageManager ?? "bun",
  source: input.source ?? "npm",
  name: input.name,
  version: input.version,
  integrity: input.integrity ?? null,
  resolution: input.resolution ?? null,
});

function createDeterministicClock(start = "2026-04-18T09:00:00.000Z") {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

describe("runtime extension state port", () => {
  const stores: StructuredSessionStateStore[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.close();
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { force: true, recursive: true });
      }
    }
  });

  function createStore() {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-extension-state-port-"));
    tempDirs.push(workspaceCwd);
    const store = createStructuredSessionStateStore({
      workspace: {
        id: "workspace_extension_state_test",
        label: "svvy",
        cwd: workspaceCwd,
        artifactDir: join(workspaceCwd, "artifact-store"),
      },
      now: createDeterministicClock(),
    });
    stores.push(store);
    return store;
  }

  it("records dependency approval as product state and invalidates extensions", async () => {
    const store = createStore();
    const port = runtimeExtensionStatePortFromStore(store);
    const dependency = extensionDependencyApprovalIdentity({
      kind: "dependency",
      name: "tinyfish",
      version: "1.2.3",
      integrity: "sha512-good",
      resolution: "https://registry.npmjs.org/tinyfish/-/tinyfish-1.2.3.tgz",
    });

    const result = await runTestEffect(
      port.recordDependencyApproval({
        dependency,
        approvedAt: isoDateTime("2026-04-18T09:00:03.000Z"),
        approvedBy: "user",
        sourceCommandId: commandId("cmd_dependency_approval_01"),
      }),
    );

    expect(result.value).toBeUndefined();
    expect(result.afterCommit).toEqual([{ scope: "app", invalidation: { model: "extensions" } }]);
    expect(store.readExtensionDependencyApproval({ dependency })).toBe(true);

    const updated = await runTestEffect(
      port.recordDependencyApproval({
        dependency,
        approvedAt: isoDateTime("2026-04-18T09:00:04.000Z"),
        approvedBy: "user",
        sourceCommandId: commandId("cmd_dependency_approval_02"),
      }),
    );

    expect(updated.value).toBeUndefined();
    expect(store.readExtensionDependencyApproval({ dependency })).toBe(true);
  });

  it("persists registry authority atomically and invalidates only changed commits", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-extension-registry-state-"));
    tempDirs.push(workspaceCwd);
    const databasePath = join(workspaceCwd, "state.sqlite");
    const makeStore = () =>
      createStructuredSessionStateStore({
        databasePath,
        workspace: {
          id: "workspace_extension_registry_test",
          label: "svvy",
          cwd: workspaceCwd,
          artifactDir: join(workspaceCwd, "artifact-store"),
        },
        now: createDeterministicClock(),
      });
    const first = makeStore();
    stores.push(first);
    const port = runtimeExtensionStatePortFromStore(first);
    const initialRevision = first.readCurrentStateRevision();

    const committed = await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registryObservation(),
        observedAt: registryObservedAt("2026-04-18T09:00:03.000Z"),
      }),
    );
    expect(committed.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "extensions" } },
    ]);
    expect(Number(first.readCurrentStateRevision())).toBe(Number(initialRevision) + 1);
    expect(first.listExtensionEnvDeclarations()).toHaveLength(2);

    const noOp = await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registryObservation(),
        observedAt: registryObservedAt("2026-04-18T09:01:03.000Z"),
      }),
    );
    expect(noOp.afterCommit).toEqual([]);
    expect(noOp.value.observedAt as string).toBe("2026-04-18T09:00:03.000Z");
    expect(Number(first.readCurrentStateRevision())).toBe(Number(initialRevision) + 1);

    first.close();
    stores.splice(stores.indexOf(first), 1);
    const reopened = makeStore();
    stores.push(reopened);
    expect(reopened.readExtensionRegistryObservation()).toEqual(committed.value);
    expect(reopened.listExtensionEnvDeclarations()).toHaveLength(2);
  });

  it("persists complete source/build evidence, preserves no-op timestamps, and prunes removed ids", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-extension-build-evidence-"));
    tempDirs.push(workspaceCwd);
    const databasePath = join(workspaceCwd, "state.sqlite");
    const makeStore = () =>
      createStructuredSessionStateStore({
        databasePath,
        workspace: {
          id: "workspace_extension_build_evidence_test",
          label: "svvy",
          cwd: workspaceCwd,
          artifactDir: join(workspaceCwd, "artifact-store"),
        },
        now: createDeterministicClock(),
      });
    let store = makeStore();
    stores.push(store);
    let port = runtimeExtensionStatePortFromStore(store);
    const sourceFingerprint = extensionSourceFingerprint("a");
    const registry = {
      ...registryObservation("sha256:registry-build-v1"),
      observations: registryObservation("sha256:registry-build-v1").observations.map(
        (observation) => ({ ...observation, sourceFingerprint }),
      ),
    };
    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registry,
        observedAt: registryObservedAt("2026-04-18T09:00:00.000Z"),
      }),
    );
    const initialRevision = Number(store.readCurrentStateRevision());
    const observation = {
      extensionId: extensionId("linear"),
      category: "user" as const,
      buildRequirement: "required" as const,
      sourceStatus: "materialized" as const,
      sourceFingerprint,
      currentBuildStatus: "missing" as const,
      currentBuild: null,
      buildRequired: true,
      diagnostics: [],
    } satisfies ExtensionSourceBuildObservation;

    const committed = await runTestEffect(
      port.reconcileBuildEvidence({
        registryAggregateFingerprint: registry.aggregateFingerprint,
        observations: [observation],
        observedAt: buildObservedAt("2026-04-18T09:00:01.000Z"),
      }),
    );
    expect(committed.value).toEqual({
      changed: true,
      changedExtensionIds: [extensionId("linear")],
    });
    expect(committed.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "extensions", ids: [extensionId("linear")] } },
    ]);
    expect(Number(store.readCurrentStateRevision())).toBe(initialRevision + 1);
    expect(store.readExtensionSourceBuildEvidence()).toMatchObject({
      registryAggregateFingerprint: registry.aggregateFingerprint,
      observations: [observation],
      observedAt: "2026-04-18T09:00:01.000Z",
    });

    const noOp = await runTestEffect(
      port.reconcileBuildEvidence({
        registryAggregateFingerprint: registry.aggregateFingerprint,
        observations: [observation],
        observedAt: buildObservedAt("2026-04-18T09:05:01.000Z"),
      }),
    );
    expect(noOp.value).toEqual({ changed: false, changedExtensionIds: [] });
    expect(noOp.afterCommit).toEqual([]);
    expect(Number(store.readCurrentStateRevision())).toBe(initialRevision + 1);
    expect(store.readExtensionSourceBuildEvidence()?.observedAt as string).toBe(
      "2026-04-18T09:00:01.000Z",
    );

    store.close();
    stores.splice(stores.indexOf(store), 1);
    store = makeStore();
    stores.push(store);
    port = runtimeExtensionStatePortFromStore(store);
    expect(store.readExtensionSourceBuildEvidence()?.observations).toEqual([observation]);

    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: {
          aggregateFingerprint: "sha256:registry-build-empty",
          observations: [],
          diagnostics: [],
        },
        observedAt: registryObservedAt("2026-04-18T09:10:00.000Z"),
      }),
    );
    const pruned = await runTestEffect(
      port.reconcileBuildEvidence({
        registryAggregateFingerprint: "sha256:registry-build-empty",
        observations: [],
        observedAt: buildObservedAt("2026-04-18T09:10:01.000Z"),
      }),
    );
    expect(pruned.value).toEqual({
      changed: true,
      changedExtensionIds: [extensionId("linear")],
    });
    expect(store.readExtensionSourceBuildEvidence()?.observations).toEqual([]);
  });

  it("rejects stale, incomplete, build-requirement-mismatched, and source-mismatched evidence", async () => {
    const store = createStore();
    const port = runtimeExtensionStatePortFromStore(store);
    const sourceFingerprint = extensionSourceFingerprint("b");
    const registry = {
      ...registryObservation("sha256:registry-build-validation"),
      observations: registryObservation("sha256:registry-build-validation").observations.map(
        (observation) => ({ ...observation, sourceFingerprint }),
      ),
    };
    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registry,
        observedAt: registryObservedAt("2026-04-18T09:00:00.000Z"),
      }),
    );
    const observation = {
      extensionId: extensionId("linear"),
      category: "user" as const,
      buildRequirement: "required" as const,
      sourceStatus: "materialized" as const,
      sourceFingerprint,
      currentBuildStatus: "missing" as const,
      currentBuild: null,
      buildRequired: true,
      diagnostics: [],
    } satisfies ExtensionSourceBuildObservation;
    const reconcile = (overrides: {
      registryAggregateFingerprint?: string;
      observations?: readonly ExtensionSourceBuildObservation[];
    }) =>
      runTestEffect(
        port.reconcileBuildEvidence({
          registryAggregateFingerprint:
            overrides.registryAggregateFingerprint ?? registry.aggregateFingerprint,
          observations: overrides.observations ?? [observation],
          observedAt: buildObservedAt("2026-04-18T09:00:01.000Z"),
        }),
      );

    await expect(reconcile({ registryAggregateFingerprint: "sha256:stale" })).rejects.toBeDefined();
    await expect(reconcile({ observations: [] })).rejects.toBeDefined();
    await expect(
      reconcile({
        observations: [{ ...observation, buildRequirement: "not-required" }],
      }),
    ).rejects.toBeDefined();
    await expect(
      reconcile({
        observations: [{ ...observation, sourceFingerprint: extensionSourceFingerprint("c") }],
      }),
    ).rejects.toBeDefined();
  });

  it("persists identity-safe build attempts and atomically promotes successful evidence", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-extension-build-attempt-"));
    tempDirs.push(workspaceCwd);
    const databasePath = join(workspaceCwd, "state.sqlite");
    const makeStore = () =>
      createStructuredSessionStateStore({
        databasePath,
        workspace: {
          id: "workspace_extension_build_attempt_test",
          label: "svvy",
          cwd: workspaceCwd,
          artifactDir: join(workspaceCwd, "artifact-store"),
        },
        now: createDeterministicClock(),
      });
    let store = makeStore();
    stores.push(store);
    let port = runtimeExtensionStatePortFromStore(store);
    const sourceFingerprint = extensionSourceFingerprint("a");
    const registry = {
      ...registryObservation("sha256:registry-build-attempt-v1"),
      observations: registryObservation("sha256:registry-build-attempt-v1").observations.map(
        (observation) => ({ ...observation, sourceFingerprint }),
      ),
    };
    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registry,
        observedAt: registryObservedAt("2026-04-18T09:00:00.000Z"),
      }),
    );
    await runTestEffect(
      port.reconcileBuildEvidence({
        registryAggregateFingerprint: registry.aggregateFingerprint,
        observations: [
          {
            extensionId: extensionId("linear"),
            category: "user",
            buildRequirement: "required",
            sourceStatus: "materialized",
            sourceFingerprint,
            currentBuildStatus: "missing",
            currentBuild: null,
            buildRequired: true,
            diagnostics: [],
          },
        ],
        observedAt: buildObservedAt("2026-04-18T09:00:01.000Z"),
      }),
    );

    const attempt = {
      attemptId: buildAttemptId("a"),
      clientRequestId: clientRequestId("build-request-a"),
      extensionId: extensionId("linear"),
      registryAggregateFingerprint: registry.aggregateFingerprint,
      sourceFingerprint,
      startedAt: extensionBuildTime("2026-04-18T09:00:02.000Z"),
    };
    const started = await runTestEffect(port.startBuildAttempt(attempt));
    expect(started.value).toMatchObject({ status: "running", finishedAt: null });
    expect(started.afterCommit).toEqual([
      {
        scope: "app",
        invalidation: { model: "extensions", ids: [extensionId("linear")] },
      },
    ]);
    const startReplay = await runTestEffect(port.startBuildAttempt(attempt));
    expect(startReplay.value).toEqual(started.value);
    expect(startReplay.afterCommit).toEqual([]);

    store.close();
    stores.splice(stores.indexOf(store), 1);
    store = makeStore();
    stores.push(store);
    port = runtimeExtensionStatePortFromStore(store);
    expect(store.readExtensionBuildAttempt(attempt.attemptId)).toEqual(started.value);
    expect(
      await runTestEffect(port.readBuildAttemptByClientRequestId(attempt.clientRequestId)),
    ).toEqual(started.value);
    await expect(
      runTestEffect(
        port.startBuildAttempt({
          ...attempt,
          attemptId: buildAttemptId("c"),
          sourceFingerprint: extensionSourceFingerprint("c"),
        }),
      ),
    ).rejects.toBeDefined();

    const manifest = currentBuildManifest(sourceFingerprint);
    const successInput = {
      attemptId: attempt.attemptId,
      clientRequestId: attempt.clientRequestId,
      extensionId: attempt.extensionId,
      registryAggregateFingerprint: attempt.registryAggregateFingerprint,
      sourceFingerprint,
      manifest,
      finishedAt: extensionBuildTime("2026-04-18T09:00:03.000Z"),
    };
    const succeeded = await runTestEffect(port.recordBuildSuccess(successInput));
    expect(succeeded.value).toMatchObject({
      status: "succeeded",
      successfulBuildId: manifest.buildId,
      failureReason: null,
    });
    expect(succeeded.afterCommit).toEqual([
      {
        scope: "app",
        invalidation: { model: "extensions", ids: [extensionId("linear")] },
      },
    ]);
    expect(store.readExtensionSourceBuildEvidence()?.observations[0]).toMatchObject({
      currentBuildStatus: "current",
      currentBuild: manifest,
      buildRequired: false,
    });
    const successReplay = await runTestEffect(port.recordBuildSuccess(successInput));
    expect(successReplay.value).toEqual(succeeded.value);
    expect(successReplay.afterCommit).toEqual([]);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    store = makeStore();
    stores.push(store);
    port = runtimeExtensionStatePortFromStore(store);
    expect(
      await runTestEffect(port.readBuildAttemptByClientRequestId(attempt.clientRequestId)),
    ).toEqual(succeeded.value);

    await expect(
      runTestEffect(
        port.recordBuildFailure({
          attemptId: attempt.attemptId,
          clientRequestId: attempt.clientRequestId,
          extensionId: attempt.extensionId,
          registryAggregateFingerprint: attempt.registryAggregateFingerprint,
          sourceFingerprint,
          failureReason: "process-failed",
          finishedAt: extensionBuildTime("2026-04-18T09:00:04.000Z"),
        }),
      ),
    ).rejects.toBeDefined();

    const failedAttempt = {
      ...attempt,
      attemptId: buildAttemptId("d"),
      clientRequestId: clientRequestId("build-request-d"),
      startedAt: extensionBuildTime("2026-04-18T09:00:05.000Z"),
    };
    await runTestEffect(port.startBuildAttempt(failedAttempt));
    const persistedFailure = await runTestEffect(
      port.recordBuildFailure({
        attemptId: failedAttempt.attemptId,
        clientRequestId: failedAttempt.clientRequestId,
        extensionId: failedAttempt.extensionId,
        registryAggregateFingerprint: failedAttempt.registryAggregateFingerprint,
        sourceFingerprint: failedAttempt.sourceFingerprint,
        failureReason: "process-failed",
        finishedAt: extensionBuildTime("2026-04-18T09:00:06.000Z"),
      }),
    );
    store.close();
    stores.splice(stores.indexOf(store), 1);
    store = makeStore();
    stores.push(store);
    port = runtimeExtensionStatePortFromStore(store);
    expect(
      await runTestEffect(port.readBuildAttemptByClientRequestId(failedAttempt.clientRequestId)),
    ).toEqual(persistedFailure.value);
  });

  it("records failure without replacing current evidence and rejects reversed terminal time", async () => {
    const store = createStore();
    const port = runtimeExtensionStatePortFromStore(store);
    const sourceFingerprint = extensionSourceFingerprint("b");
    const registry = {
      ...registryObservation("sha256:registry-build-failure-v1"),
      observations: registryObservation("sha256:registry-build-failure-v1").observations.map(
        (observation) => ({ ...observation, sourceFingerprint }),
      ),
    };
    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registry,
        observedAt: registryObservedAt("2026-04-18T09:00:00.000Z"),
      }),
    );
    const manifest = currentBuildManifest(sourceFingerprint);
    const currentObservation = {
      extensionId: extensionId("linear"),
      category: "user" as const,
      buildRequirement: "required" as const,
      sourceStatus: "materialized" as const,
      sourceFingerprint,
      currentBuildStatus: "current" as const,
      currentBuild: manifest,
      buildRequired: false,
      diagnostics: [],
    };
    await runTestEffect(
      port.reconcileBuildEvidence({
        registryAggregateFingerprint: registry.aggregateFingerprint,
        observations: [currentObservation],
        observedAt: buildObservedAt("2026-04-18T09:00:01.000Z"),
      }),
    );
    const attempt = {
      attemptId: buildAttemptId("b"),
      clientRequestId: clientRequestId("build-request-b"),
      extensionId: extensionId("linear"),
      registryAggregateFingerprint: registry.aggregateFingerprint,
      sourceFingerprint,
      startedAt: extensionBuildTime("2026-04-18T09:00:05.000Z"),
    };
    await runTestEffect(port.startBuildAttempt(attempt));
    await expect(
      runTestEffect(
        port.recordBuildFailure({
          attemptId: attempt.attemptId,
          clientRequestId: attempt.clientRequestId,
          extensionId: attempt.extensionId,
          registryAggregateFingerprint: attempt.registryAggregateFingerprint,
          sourceFingerprint: attempt.sourceFingerprint,
          failureReason: "timed-out",
          finishedAt: extensionBuildTime("2026-04-18T09:00:04.000Z"),
        }),
      ),
    ).rejects.toBeDefined();

    const failureInput = {
      attemptId: attempt.attemptId,
      clientRequestId: attempt.clientRequestId,
      extensionId: attempt.extensionId,
      registryAggregateFingerprint: attempt.registryAggregateFingerprint,
      sourceFingerprint: attempt.sourceFingerprint,
      failureReason: "timed-out" as const,
      finishedAt: extensionBuildTime("2026-04-18T09:00:06.000Z"),
    };
    const failed = await runTestEffect(port.recordBuildFailure(failureInput));
    expect(failed.value).toMatchObject({
      status: "failed",
      failureReason: "timed-out",
      successfulBuildId: null,
    });
    expect(store.readExtensionSourceBuildEvidence()?.observations).toEqual([currentObservation]);
    const failureReplay = await runTestEffect(port.recordBuildFailure(failureInput));
    expect(failureReplay.value).toEqual(failed.value);
    expect(failureReplay.afterCommit).toEqual([]);
  });

  it("records dependency readiness as product state and invalidates extensions", async () => {
    const store = createStore();
    const port = runtimeExtensionStatePortFromStore(store);

    const result = await runTestEffect(
      port.recordDependencyReadiness({
        readiness: {
          extensionId: extensionId("ext_tinyfish"),
          requirementId: "dep:tinyfish",
          requirementFingerprint: "sha256:tinyfish-v1",
          status: "ready",
          detectedVersion: "1.2.3",
          expectedVersion: "1.2.3",
          diagnostics: [],
          checkedAt: checkedAt("2026-04-18T09:00:01.000Z"),
        },
        sourceCommandId: commandId("cmd_dependency_01"),
        recordedAt: isoDateTime("2026-04-18T09:00:02.000Z"),
      }),
    );

    expect(result.value.extensionId as string).toBe("ext_tinyfish");
    expect(result.value.requirementId).toBe("dep:tinyfish");
    expect(result.value.status).toBe("ready");
    expect(result.value.detectedVersion).toBe("1.2.3");
    expect(result.value.expectedVersion).toBe("1.2.3");
    expect(result.value.diagnostics).toEqual([]);
    expect(result.value.checkedAt as string).toBe("2026-04-18T09:00:01.000Z");
    expect(result.afterCommit).toEqual([{ scope: "app", invalidation: { model: "extensions" } }]);

    const updated = await runTestEffect(
      port.recordDependencyReadiness({
        readiness: {
          extensionId: extensionId("ext_tinyfish"),
          requirementId: "dep:tinyfish",
          requirementFingerprint: "sha256:tinyfish-v1",
          status: "missing",
          detectedVersion: null,
          expectedVersion: "1.2.4",
          diagnostics: ["tinyfish executable not found"],
          checkedAt: checkedAt("2026-04-18T09:01:01.000Z"),
        },
        sourceCommandId: commandId("cmd_dependency_02"),
        recordedAt: isoDateTime("2026-04-18T09:01:02.000Z"),
      }),
    );

    expect(updated.value.extensionId as string).toBe("ext_tinyfish");
    expect(updated.value.requirementId).toBe("dep:tinyfish");
    expect(updated.value.status).toBe("missing");
    expect(updated.value.detectedVersion).toBeNull();
    expect(updated.value.expectedVersion).toBe("1.2.4");
    expect(updated.value.diagnostics).toEqual(["tinyfish executable not found"]);
    expect(updated.value.checkedAt as string).toBe("2026-04-18T09:01:01.000Z");
  });

  it("atomically reconciles a complete CLI readiness batch and prunes removed facts", async () => {
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-extension-cli-readiness-"));
    tempDirs.push(workspaceCwd);
    const databasePath = join(workspaceCwd, "state.sqlite");
    const makeStore = () =>
      createStructuredSessionStateStore({
        databasePath,
        workspace: {
          id: "workspace_extension_cli_readiness_test",
          label: "svvy",
          cwd: workspaceCwd,
          artifactDir: join(workspaceCwd, "artifact-store"),
        },
        now: createDeterministicClock(),
      });
    let store = makeStore();
    stores.push(store);
    let port = runtimeExtensionStatePortFromStore(store);
    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registryObservationWithCli(),
        observedAt: registryObservedAt("2026-04-18T09:00:00.000Z"),
      }),
    );
    const initialRevision = Number(store.readCurrentStateRevision());
    const readiness = {
      extensionId: extensionId("linear"),
      requirementId: "linear-cli",
      requirementFingerprint: "sha256:linear-cli-v1",
      status: "update-available" as const,
      detectedVersion: "1.2.2",
      expectedVersion: "1.2.3",
      diagnostics: [],
      checkedAt: checkedAt("2026-04-18T09:00:01.000Z"),
    };

    const committed = await runTestEffect(
      port.reconcileDependencyReadiness({
        registryAggregateFingerprint: "sha256:registry-cli-v1",
        readiness: [readiness],
        recordedAt: dependencyRecordedAt("2026-04-18T09:00:02.000Z"),
      }),
    );
    expect(committed.value).toEqual({ changed: true, readiness: [readiness] });
    expect(committed.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "extensions" } },
    ]);
    expect(Number(store.readCurrentStateRevision())).toBe(initialRevision + 1);
    expect(store.listExtensionDependencyReadiness()).toEqual([readiness]);

    const noOp = await runTestEffect(
      port.reconcileDependencyReadiness({
        registryAggregateFingerprint: "sha256:registry-cli-v1",
        readiness: [readiness],
        recordedAt: dependencyRecordedAt("2026-04-18T09:01:02.000Z"),
      }),
    );
    expect(noOp.value.changed).toBe(false);
    expect(noOp.afterCommit).toEqual([]);
    expect(Number(store.readCurrentStateRevision())).toBe(initialRevision + 1);

    store.close();
    stores.splice(stores.indexOf(store), 1);
    store = makeStore();
    stores.push(store);
    port = runtimeExtensionStatePortFromStore(store);
    expect(store.readExtensionDependencyReadinessBatch()).toMatchObject({
      registryAggregateFingerprint: "sha256:registry-cli-v1",
      readiness: [readiness],
    });

    await expect(
      runTestEffect(
        port.reconcileDependencyReadiness({
          registryAggregateFingerprint: "sha256:stale-registry",
          readiness: [readiness],
          recordedAt: dependencyRecordedAt("2026-04-18T09:02:02.000Z"),
        }),
      ),
    ).rejects.toBeDefined();
    await expect(
      runTestEffect(
        port.reconcileDependencyReadiness({
          registryAggregateFingerprint: "sha256:registry-cli-v1",
          readiness: [{ ...readiness, requirementFingerprint: "sha256:stale-requirement" }],
          recordedAt: dependencyRecordedAt("2026-04-18T09:02:03.000Z"),
        }),
      ),
    ).rejects.toBeDefined();

    await runTestEffect(
      port.reconcileRegistryObservation({
        observation: registryObservation("sha256:registry-cli-v2"),
        observedAt: registryObservedAt("2026-04-18T09:03:00.000Z"),
      }),
    );
    const pruned = await runTestEffect(
      port.reconcileDependencyReadiness({
        registryAggregateFingerprint: "sha256:registry-cli-v2",
        readiness: [],
        recordedAt: dependencyRecordedAt("2026-04-18T09:03:02.000Z"),
      }),
    );
    expect(pruned.value.changed).toBe(true);
    expect(store.listExtensionDependencyReadiness()).toEqual([]);
  });
});
