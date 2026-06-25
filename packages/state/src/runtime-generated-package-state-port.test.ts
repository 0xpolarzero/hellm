import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AbsolutePath,
  CommandId,
  GeneratedPackageBuildId,
  RecoveryWorkId,
  WorkspaceId,
} from "@svvy/core";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runtimeGeneratedPackageStatePortFromStore } from "./runtime-generated-package-state-port";
import { runTestEffect } from "./effect.test-support";

const absolutePath = (value: string): AbsolutePath => value as AbsolutePath;
const commandId = (value: string): CommandId => value as CommandId;
const generatedPackageBuildId = (value: string): GeneratedPackageBuildId =>
  value as GeneratedPackageBuildId;
const recoveryWorkId = (value: string): RecoveryWorkId => value as RecoveryWorkId;
const workspaceId = (value: string): WorkspaceId => value as WorkspaceId;

function createDeterministicClock(start = "2026-04-18T09:00:00.000Z") {
  let cursor = Date.parse(start);
  return () => {
    const next = new Date(cursor).toISOString();
    cursor += 1_000;
    return next;
  };
}

describe("runtime generated package state port", () => {
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
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-generated-package-port-"));
    tempDirs.push(workspaceCwd);
    const store = createStructuredSessionStateStore({
      workspace: {
        id: "workspace_generated_package_test",
        label: "svvy",
        cwd: workspaceCwd,
        artifactDir: join(workspaceCwd, "artifact-store"),
      },
      now: createDeterministicClock(),
    });
    stores.push(store);
    return store;
  }

  it("records generated package build facts without duplicating generated file lists", () => {
    const store = createStore();
    const port = runtimeGeneratedPackageStatePortFromStore(store);
    expect(typeof port.recordGeneratedPackageBuild).toBe("function");

    const fact = store.recordGeneratedPackageBuild({
      status: {
        packageName: "@svvyx/workflows",
        action: "written",
        buildId: generatedPackageBuildId("generated-package-build-001"),
        manifestPath: absolutePath("/tmp/generated-workflows/package.json"),
        sourceFingerprint: "source-fingerprint-001",
        outputFingerprint: "output-fingerprint-001",
        generatedFiles: [
          {
            relativePath: "index.ts",
            path: absolutePath("/tmp/generated-workflows/index.ts"),
          },
          {
            relativePath: "package.json",
            path: absolutePath("/tmp/generated-workflows/package.json"),
          },
        ],
        dependencies: [
          {
            kind: "package",
            name: "smithers-orchestrator",
            resolution: "package-manager",
            version: "0.22.0",
          },
        ],
      },
      sourceCommandId: commandId("cmd_generated_package_001"),
      recoveryWorkId: recoveryWorkId("recovery_generated_package_001"),
    });

    expect(fact).toMatchObject({
      packageName: "@svvyx/workflows",
      status: "ready",
      buildId: "generated-package-build-001",
      manifestPath: "/tmp/generated-workflows/package.json",
      sourceFingerprint: "source-fingerprint-001",
      outputFingerprint: "output-fingerprint-001",
      dependencies: [
        {
          kind: "package",
          name: "smithers-orchestrator",
          resolution: "package-manager",
          version: "0.22.0",
        },
      ],
      sourceCommandId: "cmd_generated_package_001",
      refreshNeededReason: null,
      lastRecoveryWorkId: "recovery_generated_package_001",
    });
    expect(fact.generatedFileListDigest).toMatch(/^[a-f0-9]{64}$/);

    const readBack = store.readGeneratedPackageFacts({ packages: ["@svvyx/workflows"] });
    expect(readBack).toEqual([fact]);
  });

  it("records failed builds while preserving the previous ready output evidence", async () => {
    const store = createStore();
    const port = runtimeGeneratedPackageStatePortFromStore(store);
    const ready = store.recordGeneratedPackageBuild({
      status: {
        packageName: "@svvyx/extensions",
        action: "written",
        buildId: generatedPackageBuildId("generated-package-build-ready"),
        manifestPath: absolutePath("/tmp/generated-extensions/package.json"),
        sourceFingerprint: "source-ready",
        outputFingerprint: "output-ready",
        generatedFiles: [
          {
            relativePath: "index.ts",
            path: absolutePath("/tmp/generated-extensions/index.ts"),
          },
        ],
      },
      sourceCommandId: commandId("cmd_ready"),
    });

    const failedResult = await runTestEffect(
      port.recordGeneratedPackageFailure({
        status: {
          packageName: "@svvyx/extensions",
          action: "failed",
          diagnostics: ["Extension source failed validation."],
        },
        sourceCommandId: commandId("cmd_failed"),
        recoveryWorkId: recoveryWorkId("recovery_failed"),
      }),
    );
    const failed = failedResult.value;

    expect(failed).toMatchObject({
      packageName: "@svvyx/extensions",
      status: "failed",
      buildId: ready.buildId,
      manifestPath: ready.manifestPath,
      sourceFingerprint: ready.sourceFingerprint,
      outputFingerprint: ready.outputFingerprint,
      generatedFileListDigest: ready.generatedFileListDigest,
      diagnostics: ["Extension source failed validation."],
      sourceCommandId: "cmd_failed",
      lastRecoveryWorkId: "recovery_failed",
    });
    expect(failedResult.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "extensions" } },
    ]);
  });

  it("marks refresh-needed state and reconciles decoded manifest facts", async () => {
    const store = createStore();
    const port = runtimeGeneratedPackageStatePortFromStore(store);

    const neededResult = await runTestEffect(
      port.markGeneratedPackageRefreshNeeded({
        packageName: "@svvyx/workflows",
        reason: "source-fingerprint-changed",
        recoveryWorkId: recoveryWorkId("recovery_refresh_needed"),
      }),
    );
    const needed = neededResult.value;
    expect(needed).toMatchObject({
      status: "refresh-needed",
      refreshNeededReason: "source-fingerprint-changed",
      lastRecoveryWorkId: "recovery_refresh_needed",
    });
    expect(neededResult.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "workflowsGenerated" } },
    ]);

    const reconciledResult = await runTestEffect(
      port.reconcileGeneratedPackageManifest({
        fact: {
          packageName: "@svvyx/workflows",
          buildId: generatedPackageBuildId("generated-package-build-reconciled"),
          manifestPath: absolutePath("/tmp/generated-workflows/package.json"),
          sourceFingerprint: "source-reconciled",
          outputFingerprint: "output-reconciled",
          generatedFileListDigest: "f".repeat(64),
          dependencies: [],
        },
        sourceCommandId: commandId("cmd_reconcile"),
      }),
    );
    const reconciled = reconciledResult.value;
    expect(reconciled).toMatchObject({
      status: "ready",
      buildId: "generated-package-build-reconciled",
      refreshNeededReason: null,
      sourceCommandId: "cmd_reconcile",
    });
    expect(reconciledResult.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "workflowsGenerated" } },
    ]);
  });

  it("records workspace link facts and reads only links needing repair", async () => {
    const store = createStore();
    const port = runtimeGeneratedPackageStatePortFromStore(store);
    store.recordWorkspaceLinkStatus({
      status: {
        workspaceId: workspaceId("workspace-a"),
        packageName: "@svvyx/workflows",
        status: "linked",
        linkPath: absolutePath("/repo-a/.smithers/node_modules/@svvyx/workflows"),
        targetPath: absolutePath("/tmp/generated-workflows"),
      },
    });
    const blockedResult = await runTestEffect(
      port.recordWorkspaceLinkStatus({
        status: {
          workspaceId: workspaceId("workspace-b"),
          packageName: "@svvyx/workflows",
          status: "blocked-non-symlink",
          linkPath: absolutePath("/repo-b/.smithers/node_modules/@svvyx/workflows"),
          targetPath: absolutePath("/tmp/generated-workflows"),
          diagnostics: ["Existing path is not a symlink."],
        },
        sourceCommandId: commandId("cmd_link_repair"),
        recoveryWorkId: recoveryWorkId("recovery_link_repair"),
      }),
    );
    const blocked = blockedResult.value;

    expect(blocked).toMatchObject({
      workspaceId: "workspace-b",
      packageName: "@svvyx/workflows",
      status: "blocked-non-symlink",
      diagnostics: ["Existing path is not a symlink."],
      sourceCommandId: "cmd_link_repair",
      lastRecoveryWorkId: "recovery_link_repair",
    });
    expect(blockedResult.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "workflowsGenerated" } },
    ]);
    expect(store.readLinksNeedingRepair({ packages: ["@svvyx/workflows"] })).toEqual([blocked]);
  });
});
