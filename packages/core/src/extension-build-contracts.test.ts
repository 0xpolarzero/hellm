import { describe, expect, test } from "bun:test";
import * as Exit from "effect/Exit";

import {
  decodeUnknownBuildExtensionResultExit,
  decodeUnknownBuildRuntimeExtensionInputExit,
  decodeUnknownBuildRuntimeExtensionResultExit,
  decodeUnknownExtensionCurrentBuildManifestExit,
  decodeUnknownExtensionBuildProcessPlanExit,
  decodeUnknownExtensionBuildProcessEvidenceExit,
  decodeUnknownSvvyxCommandManifestExit,
  decodeUnknownExtensionSourceBuildObservationExit,
  encodeExtensionCurrentBuildManifestExit,
} from "./extension-build-contracts";
import { decodeUnknownExtensionBuildAttemptRecordExit } from "./runtime-state-ports";

const hash = `sha256:${"a".repeat(64)}`;
const manifest = {
  schemaVersion: 1,
  buildId: `extension-build:fixture:${"a".repeat(64)}`,
  extensionId: "fixture",
  interfaceKind: "svvyx",
  sourceFingerprint: hash,
  contextFingerprint: hash,
  outputFingerprint: hash,
  contextReady: true,
  generatedFiles: [
    {
      role: "runtime-module",
      relativePath: "empty.js",
      contentHash: hash,
      byteSize: 0,
    },
  ],
  builtAt: "2026-07-12T10:00:00.000Z",
} as const;

describe("extension build contracts", () => {
  test("strictly decodes and encodes a current manifest with empty-file evidence", () => {
    const decoded = decodeUnknownExtensionCurrentBuildManifestExit(manifest);
    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isFailure(decoded)) return;
    expect(Exit.isSuccess(encodeExtensionCurrentBuildManifestExit(decoded.value))).toBe(true);
  });

  test("rejects invalid branded fingerprints and excess manifest fields", () => {
    expect(
      Exit.isFailure(
        decodeUnknownExtensionCurrentBuildManifestExit({
          ...manifest,
          sourceFingerprint: "registry-fingerprint",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExtensionCurrentBuildManifestExit({ ...manifest, runtimeReady: true }),
      ),
    ).toBe(true);
  });

  test("rejects excess observation fields", () => {
    expect(
      Exit.isFailure(
        decodeUnknownExtensionSourceBuildObservationExit({
          extensionId: "fixture",
          category: "user",
          buildRequirement: "required",
          sourceStatus: "materialized",
          sourceFingerprint: hash,
          currentBuildStatus: "current",
          currentBuild: manifest,
          buildRequired: false,
          diagnostics: [],
          runtimeReady: true,
        }),
      ),
    ).toBe(true);
  });

  test("strictly decodes env-free build process plans", () => {
    const plan = {
      extensionId: "fixture",
      sourceRoot: "/extensions/sources/user/fixture",
      stagingRoot: "/extensions/builds/extensions/fixture/staging/run",
      generators: [
        {
          scriptPath: "/extensions/sources/user/fixture/scripts/generate.ts",
          outputPath:
            "/extensions/builds/extensions/fixture/staging/run/instructions/full/generated.md",
          argv: ["--output", "instructions/full/generated.md"],
        },
      ],
      expectedProcessOutputs: [
        { role: "full-instruction", relativePath: "instructions/full/generated.md" },
      ],
      svvyxRuntime: null,
      timeoutMs: 30_000,
      maxStdoutBytes: 16_384,
      maxStderrBytes: 16_384,
    };
    expect(Exit.isSuccess(decodeUnknownExtensionBuildProcessPlanExit(plan))).toBe(true);
    expect(Exit.isFailure(decodeUnknownExtensionBuildProcessPlanExit({ ...plan, env: {} }))).toBe(
      true,
    );
  });

  test("requires an actionable stage for failed build process evidence", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownExtensionBuildProcessEvidenceExit({
          status: "failed",
          stage: "output-verification",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(decodeUnknownExtensionBuildProcessEvidenceExit({ status: "failed" })),
    ).toBe(true);
  });

  test("strictly decodes unique svvyx command manifests", () => {
    const commandManifest = {
      version: "incur.v1",
      commands: [
        {
          name: "echo",
          schema: {
            options: { type: "object", properties: { value: { type: "string" } } },
          },
        },
      ],
    };
    expect(Exit.isSuccess(decodeUnknownSvvyxCommandManifestExit(commandManifest))).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxCommandManifestExit({
          ...commandManifest,
          commands: [commandManifest.commands[0], commandManifest.commands[0]],
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxCommandManifestExit({
          ...commandManifest,
          compatibilityVersion: 1,
        }),
      ),
    ).toBe(true);
  });

  test("strictly decodes build results without runtime readiness", () => {
    expect(
      Exit.isSuccess(
        decodeUnknownBuildExtensionResultExit({
          registryAggregateFingerprint: "registry-fingerprint",
          manifest,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownBuildExtensionResultExit({
          registryAggregateFingerprint: "registry-fingerprint",
          manifest,
          runtimeReady: true,
        }),
      ),
    ).toBe(true);
  });

  test("enforces build-attempt terminal fields and timestamp order", () => {
    const running = {
      attemptId: `extension-build-attempt:fixture:${"b".repeat(64)}`,
      clientRequestId: "build-request-fixture",
      extensionId: "fixture",
      registryAggregateFingerprint: "registry-fingerprint",
      sourceFingerprint: hash,
      status: "running",
      failureReason: null,
      successfulBuildId: null,
      startedAt: "2026-07-12T10:00:00.000Z",
      finishedAt: null,
    } as const;
    expect(Exit.isSuccess(decodeUnknownExtensionBuildAttemptRecordExit(running))).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExtensionBuildAttemptRecordExit({
          ...running,
          status: "succeeded",
          successfulBuildId: manifest.buildId,
          finishedAt: "2026-07-12T09:59:59.999Z",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExtensionBuildAttemptRecordExit({
          ...running,
          status: "failed",
          failureReason: "process-failed",
          successfulBuildId: manifest.buildId,
          finishedAt: "2026-07-12T10:00:01.000Z",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownExtensionBuildAttemptRecordExit({ ...running, stdout: "sensitive output" }),
      ),
    ).toBe(true);
  });

  test("keeps runtime build callers on extension identity and success evidence only", () => {
    expect(
      Exit.isFailure(decodeUnknownBuildRuntimeExtensionInputExit({ extensionId: "fixture" })),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownBuildRuntimeExtensionInputExit({
          extensionId: "fixture",
          clientRequestId: "build-request-fixture",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownBuildRuntimeExtensionInputExit({
          extensionId: "fixture",
          clientRequestId: "build-request-fixture",
          registryObservation: {},
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownBuildRuntimeExtensionResultExit({
          attemptId: `extension-build-attempt:fixture:${"b".repeat(64)}`,
          registryAggregateFingerprint: "registry-fingerprint",
          manifest,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownBuildRuntimeExtensionResultExit({
          attemptId: `extension-build-attempt:fixture:${"b".repeat(64)}`,
          registryAggregateFingerprint: "registry-fingerprint",
          manifest,
          attempt: {},
        }),
      ),
    ).toBe(true);
  });
});
