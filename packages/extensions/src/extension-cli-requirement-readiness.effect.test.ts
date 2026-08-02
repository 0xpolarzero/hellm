import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  ExtensionError,
  type ExtensionCliDeclaration,
  type ExtensionCliRequirementProbeEvidence,
  type ExtensionCliRequirementProbePlan,
  type ExtensionId,
  type ExtensionRegistryObservationResult,
} from "@svvy/core";
import {
  ExtensionCliRequirementProbePort,
  type ExtensionCliRequirementProbePortService,
} from "./extension-cli-requirement-probe-port";
import {
  planForDeclaration,
  refreshExtensionCliRequirementReadiness,
} from "./extension-cli-requirement-readiness";

describe("extension CLI requirement readiness", () => {
  it.effect("builds direct bounded plans with no ambient environment", () => {
    const plans: ExtensionCliRequirementProbePlan[] = [];
    return Effect.gen(function* () {
      const result = yield* refreshExtensionCliRequirementReadiness({
        registryObservation: registry([
          declaration("exact", { defaultVersion: "1.2.3" }),
          declaration("unversioned", { defaultVersion: null }),
        ]),
      });

      assert.deepStrictEqual(
        plans.map((plan) => ({
          executable: plan.executable,
          argv: plan.argv,
          env: plan.env,
          extendEnv: plan.extendEnv,
          timeoutMs: plan.timeoutMs,
          maxStdoutBytes: plan.maxStdoutBytes,
          maxStderrBytes: plan.maxStderrBytes,
        })),
        [
          {
            executable: "exact",
            argv: ["--version"],
            env: {},
            extendEnv: false,
            timeoutMs: 1_000,
            maxStdoutBytes: 16_384,
            maxStderrBytes: 16_384,
          },
          {
            executable: "unversioned",
            argv: ["--version"],
            env: {},
            extendEnv: false,
            timeoutMs: 1_000,
            maxStdoutBytes: 16_384,
            maxStderrBytes: 16_384,
          },
        ],
      );
      assert.deepStrictEqual(
        result.readiness.map((item) => [item.requirementId, item.status]),
        [
          ["exact", "ready"],
          ["unversioned", "available"],
        ],
      );
    }).pipe(
      Effect.provideService(
        ExtensionCliRequirementProbePort,
        probeService((plan) => {
          plans.push(plan);
          return completed(`${plan.requirementId} 1.2.3`);
        }),
      ),
    );
  });

  it.effect("maps missing, unknown, update, and mismatch evidence without throwing", () => {
    const evidence = new Map<string, ExtensionCliRequirementProbeEvidence>([
      ["missing", { status: "missing" }],
      ["timeout", { status: "timed-out" }],
      ["invalid", completed("not a semantic version")],
      ["update", completed("update 1.0.0")],
      ["mismatch", completed("mismatch 1.0.0")],
      ["nonzero", { ...completed("nonzero 2.0.0"), exitCode: 1 }],
      ["truncated", { ...completed("truncated 2.0.0"), stdoutTruncated: true }],
    ]);
    return Effect.gen(function* () {
      const result = yield* refreshExtensionCliRequirementReadiness({
        registryObservation: registry([
          declaration("missing"),
          declaration("timeout"),
          declaration("invalid"),
          declaration("update", { installCommand: "install {{version}}" }),
          declaration("mismatch"),
          declaration("nonzero"),
          declaration("truncated"),
        ]),
      });
      assert.deepStrictEqual(
        result.readiness.map((item) => [item.requirementId, item.status, item.detectedVersion]),
        [
          ["missing", "missing", null],
          ["timeout", "unknown", null],
          ["invalid", "unknown", null],
          ["update", "update-available", "1.0.0"],
          ["mismatch", "version-mismatch", "1.0.0"],
          ["nonzero", "unknown", null],
          ["truncated", "unknown", null],
        ],
      );
    }).pipe(
      Effect.provideService(
        ExtensionCliRequirementProbePort,
        probeService((plan) => evidence.get(plan.requirementId)!),
      ),
    );
  });

  it.effect(
    "uses executable resolution only for package runners and never requests a fetch",
    () => {
      const plans: ExtensionCliRequirementProbePlan[] = [];
      return Effect.gen(function* () {
        const result = yield* refreshExtensionCliRequirementReadiness({
          registryObservation: registry([
            declaration("smithers", {
              binary: "bunx",
              defaultVersion: "0.22.0",
              versionCommand: "bunx smthrs --version",
            }),
          ]),
        });
        assert.deepStrictEqual(plans, [
          {
            extensionId: "test-extension" as ExtensionId,
            requirementId: "smithers",
            requirementFingerprint: "sha256:smithers",
            probeKind: "resolve-executable",
            executable: "bunx",
            argv: [],
            env: {},
            extendEnv: false,
            timeoutMs: 1_000,
            maxStdoutBytes: 16_384,
            maxStderrBytes: 16_384,
          },
        ]);
        assert.strictEqual(result.readiness[0]?.status, "available");
      }).pipe(
        Effect.provideService(
          ExtensionCliRequirementProbePort,
          probeService((plan) => {
            plans.push(plan);
            return { status: "resolved" };
          }),
        ),
      );
    },
  );

  it.effect("rejects shell controls and commands targeting another executable", () =>
    Effect.gen(function* () {
      const controls = yield* refreshExtensionCliRequirementReadiness({
        registryObservation: registry([
          declaration("unsafe", { versionCommand: "unsafe --version | tee /tmp/version" }),
        ]),
      }).pipe(Effect.flip);
      assert.instanceOf(controls, ExtensionError);
      assert.strictEqual(controls.reason, "invalid-input");

      const otherExecutable = yield* refreshExtensionCliRequirementReadiness({
        registryObservation: registry([
          declaration("mismatch", { versionCommand: "other --version" }),
        ]),
      }).pipe(Effect.flip);
      assert.instanceOf(otherExecutable, ExtensionError);
      assert.match(otherExecutable.message, /declared binary/);
    }).pipe(
      Effect.provideService(
        ExtensionCliRequirementProbePort,
        probeService(() => ({ status: "failed" })),
      ),
    ),
  );

  it.effect("turns typed probe-port failures into deterministic unknown readiness", () =>
    Effect.gen(function* () {
      const result = yield* refreshExtensionCliRequirementReadiness({
        registryObservation: registry([declaration("broken")]),
      });
      assert.deepStrictEqual(result.readiness[0], {
        extensionId: "test-extension" as ExtensionId,
        requirementId: "broken",
        requirementFingerprint: "sha256:broken",
        status: "unknown",
        detectedVersion: null,
        expectedVersion: "2.0.0",
        diagnostics: ["CLI_STATUS_UNKNOWN"],
      });
    }).pipe(
      Effect.provideService(ExtensionCliRequirementProbePort, {
        probe: () =>
          Effect.fail(
            new ExtensionError({
              operation: "test.cli-probe",
              reason: "execution-failed",
              message: "probe host unavailable",
            }),
          ),
      }),
    ),
  );

  it("ties the plan to the declaration fingerprint without recomputing host authority", () => {
    const first = planForDeclaration(
      "test-extension" as ExtensionId,
      declaration("stable", { requirementFingerprint: "sha256:first" }),
    );
    const second = planForDeclaration(
      "test-extension" as ExtensionId,
      declaration("stable", { requirementFingerprint: "sha256:second" }),
    );
    assert.notStrictEqual(first.requirementFingerprint, second.requirementFingerprint);
  });
});

function declaration(
  id: string,
  overrides: Partial<ExtensionCliDeclaration> = {},
): ExtensionCliDeclaration {
  return {
    id,
    requirementFingerprint: `sha256:${id}`,
    binary: id,
    package: null,
    required: true,
    defaultVersion: "2.0.0",
    versionCommand: `${id} --version`,
    installCommand: null,
    nodeRequirement: null,
    ...overrides,
  };
}

function registry(
  cliDeclarations: readonly ExtensionCliDeclaration[],
): ExtensionRegistryObservationResult {
  return {
    aggregateFingerprint: "sha256:registry",
    observations: [
      {
        extensionId: "test-extension" as ExtensionId,
        category: "user",
        interfaceKind: "svvyx",
        svvyxImplementation: {
          kind: "source-runtime",
          sourceRelativePath: "source/index.ts",
        },
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
        title: "Test Extension",
        description: "Test extension description.",
        customized: false,
        materializationPlan: null,
        capabilities: {
          resettable: false,
          deletable: true,
          typescriptApiEnabled: false,
          materializationRequired: false,
        },
        contributors: [],
        tooling: [],
        cliDeclarations,
        envDeclarations: [],
        dependencyDeclarations: [],
        sourceFingerprint: "sha256:source",
        diagnostics: [],
      },
    ],
    diagnostics: [],
  };
}

function probeService(
  probe: (plan: ExtensionCliRequirementProbePlan) => ExtensionCliRequirementProbeEvidence,
): ExtensionCliRequirementProbePortService {
  return { probe: (plan) => Effect.sync(() => probe(plan)) };
}

function completed(
  stdout: string,
): Extract<ExtensionCliRequirementProbeEvidence, { status: "completed" }> {
  return {
    status: "completed",
    exitCode: 0,
    stdout,
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}
