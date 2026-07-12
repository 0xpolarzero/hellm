import { describe, expect, test } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownExtensionRegistryObservationExit,
  decodeUnknownExtensionRegistryObservationResultExit,
  decodeUnknownExtensionRegistryUsagePolicyExit,
  decodeUnknownExtensionCliRequirementProbePlanExit,
  decodeUnknownExtensionCliRequirementProbeEvidenceExit,
  decodeUnknownRefreshExtensionCliRequirementReadinessResultExit,
  decodeUnknownReconcileExtensionRegistryObservationInputExit,
  encodeExtensionRegistryObservationResultExit,
  encodeExtensionRegistryUsagePolicyExit,
} from "./extension-inventory-contracts";

const observation = {
  extensionId: "linear",
  category: "user",
  interfaceKind: "svvyx",
  svvyxImplementation: {
    kind: "source-runtime",
    sourceRelativePath: "source/index.ts",
  },
  title: "Linear",
  description: "Manage Linear issues.",
  customized: true,
  buildRequirement: "required",
  usagePolicy: {
    canonicalOrder: 19,
    baselineUsage: {
      orchestrator: "loaded",
      handler: "unavailable",
      "workflow-task": "loaded",
    },
    networkAccess: "not-required",
    configurable: true,
    fixedReason: null,
  },
  materializationPlan: null,
  capabilities: {
    resettable: false,
    deletable: true,
    typescriptApiEnabled: true,
    materializationRequired: false,
  },
  contributors: [
    {
      kind: "instruction",
      name: "010-linear.md",
      bypassed: false,
      editable: true,
      openable: true,
      requiresMaterialization: false,
      source: {
        sourceKind: "user-extension",
        sourceId: "linear#instruction/010-linear.md",
      },
    },
  ],
  tooling: [
    {
      kind: "svvyx-source",
      name: "source/index.ts",
      openable: true,
      requiresMaterialization: false,
      source: { sourceKind: "user-extension", sourceId: "linear#svvyx-source" },
    },
    {
      kind: "command-schema",
      name: "commands.json",
      openable: false,
      requiresMaterialization: false,
      source: { sourceKind: "user-extension", sourceId: "linear#command-schema" },
    },
    {
      kind: "typescript-api-declaration",
      name: "index.d.ts",
      openable: false,
      requiresMaterialization: false,
      source: {
        sourceKind: "user-extension",
        sourceId: "linear#typescript-api-declaration",
      },
    },
  ],
  cliDeclarations: [
    {
      id: "linear-cli",
      requirementFingerprint: "sha256:linear-cli",
      binary: "linear",
      package: "@example/linear-cli",
      required: true,
      defaultVersion: "1.2.3",
      versionCommand: "linear --version",
      installCommand: "bun add -g @example/linear-cli@{{version}}",
      nodeRequirement: ">=22",
    },
  ],
  envDeclarations: [
    {
      name: "LINEAR_TOKEN",
      required: true,
      secret: true,
      description: "Linear API token.",
      hasDefault: false,
    },
  ],
  dependencyDeclarations: [
    {
      kind: "trusted_dependency",
      packageManager: "bun",
      source: "npm",
      name: "linear-sdk",
      version: "4.0.0",
      integrity: null,
      resolution: null,
    },
  ],
  sourceFingerprint: "sha256:source",
  diagnostics: [],
} as const;

describe("extension inventory contracts", () => {
  test("round-trips schema-backed registry observation results", () => {
    const decoded = decodeUnknownExtensionRegistryObservationResultExit({
      aggregateFingerprint: "sha256:aggregate",
      observations: [observation],
      diagnostics: [],
    });
    expect(Exit.isSuccess(decoded)).toBe(true);
    if (!Exit.isSuccess(decoded)) return;
    expect(Exit.isSuccess(encodeExtensionRegistryObservationResultExit(decoded.value))).toBe(true);
  });

  test("rejects invalid env identities and unknown fields at the boundary", () => {
    const invalidEnv = {
      ...structuredClone(observation),
      envDeclarations: [{ ...observation.envDeclarations[0], name: "linear-token" }],
    };
    expect(Exit.isFailure(decodeUnknownExtensionRegistryObservationExit(invalidEnv))).toBe(true);

    const unknownField = { ...observation, sourcePath: "/private/source" };
    expect(Exit.isFailure(decodeUnknownExtensionRegistryObservationExit(unknownField))).toBe(true);

    const unknownSourceField = {
      ...structuredClone(observation),
      tooling: observation.tooling.map((item, index) =>
        index === 1
          ? {
              ...item,
              source: {
                ...item.source,
                path: "/private/generated/commands.json",
              },
            }
          : item,
      ),
    };
    expect(Exit.isFailure(decodeUnknownExtensionRegistryObservationExit(unknownSourceField))).toBe(
      true,
    );
  });

  test("strictly validates the fixed usage-policy reason invariant", () => {
    const configurable = observation.usagePolicy;
    const decoded = decodeUnknownExtensionRegistryUsagePolicyExit(configurable);
    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(Exit.isSuccess(encodeExtensionRegistryUsagePolicyExit(decoded.value))).toBe(true);
    }
    expect(
      Exit.isFailure(
        decodeUnknownExtensionRegistryUsagePolicyExit({
          ...configurable,
          configurable: false,
          fixedReason: null,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExtensionRegistryUsagePolicyExit({
          ...configurable,
          fixedReason: "Unexpected fixed reason",
        }),
      ),
    ).toBe(true);
  });

  test("decodes the app-global registry reconcile input strictly", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownReconcileExtensionRegistryObservationInputExit({
          observation: {
            aggregateFingerprint: "sha256:aggregate",
            observations: [observation],
            diagnostics: [],
          },
          observedAt: "2026-07-12T10:00:00.000Z",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownReconcileExtensionRegistryObservationInputExit({
          observation: {
            aggregateFingerprint: "sha256:aggregate",
            observations: [observation],
            diagnostics: [],
          },
          observedAt: "2026-07-12T10:00:00.000Z",
          workspaceId: "not-app-global",
        }),
      ),
    ).toBe(true);
  });

  test("strictly validates closed CLI probe plans and evidence", () => {
    const plan = {
      extensionId: "linear",
      requirementId: "linear-cli",
      requirementFingerprint: "sha256:linear-cli",
      probeKind: "execute-version",
      executable: "linear",
      argv: ["--version"],
      env: {},
      extendEnv: false,
      timeoutMs: 1_000,
      maxStdoutBytes: 16_384,
      maxStderrBytes: 16_384,
    };
    expect(Exit.isSuccess(decodeUnknownExtensionCliRequirementProbePlanExit(plan))).toBe(true);
    expect(
      Exit.isFailure(decodeUnknownExtensionCliRequirementProbePlanExit({ ...plan, shell: true })),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExtensionCliRequirementProbePlanExit({ ...plan, extendEnv: true }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownExtensionCliRequirementProbeEvidenceExit({
          status: "completed",
          exitCode: 0,
          stdout: "linear 1.2.3",
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
        }),
      ),
    ).toBe(true);
  });

  test("requires declaration fingerprints on CLI readiness evidence", () => {
    const result = {
      registryAggregateFingerprint: "sha256:aggregate",
      readiness: [
        {
          extensionId: "linear",
          requirementId: "linear-cli",
          requirementFingerprint: "sha256:linear-cli",
          status: "ready",
          detectedVersion: "1.2.3",
          expectedVersion: "1.2.3",
          diagnostics: [],
        },
      ],
    };
    expect(
      Exit.isSuccess(decodeUnknownRefreshExtensionCliRequirementReadinessResultExit(result)),
    ).toBe(true);
    const { requirementFingerprint: _, ...withoutFingerprint } = result.readiness[0]!;
    const missingFingerprint = { ...result, readiness: [withoutFingerprint] };
    expect(
      Exit.isFailure(
        decodeUnknownRefreshExtensionCliRequirementReadinessResultExit(missingFingerprint),
      ),
    ).toBe(true);
  });
});
