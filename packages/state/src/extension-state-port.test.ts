import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AbsolutePath,
  CommandId,
  ExtensionDependencyApprovalIdentity,
  ExtensionDependencyReadiness,
  ExtensionId,
  IsoDateTimeString,
  RecordRuntimeSourceScanInput,
} from "@svvy/core";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { extensionStatePortFromStore } from "./extension-state-port";
import { runTestEffect } from "./effect.test-support";

const commandId = (value: string): CommandId => value as CommandId;
const extensionId = (value: string): ExtensionId => value as ExtensionId;
const absolutePath = (value: string): AbsolutePath => value as AbsolutePath;
const checkedAt = (value: string): NonNullable<ExtensionDependencyReadiness["checkedAt"]> =>
  value as NonNullable<ExtensionDependencyReadiness["checkedAt"]>;
const isoDateTime = (value: string): IsoDateTimeString => value as IsoDateTimeString;
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

describe("extension state port", () => {
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
    const workspaceCwd = mkdtempSync(join(tmpdir(), "svvy-extension-state-read-port-"));
    tempDirs.push(workspaceCwd);
    const store = createStructuredSessionStateStore({
      workspace: {
        id: "workspace_extension_state_read_test",
        label: "svvy",
        cwd: workspaceCwd,
        artifactDir: join(workspaceCwd, "artifact-store"),
      },
      now: createDeterministicClock(),
    });
    stores.push(store);
    return store;
  }

  it("reads dependency readiness, approval, and source fingerprints from state", async () => {
    const store = createStore();
    const extensionIdValue = extensionId("ext_tinyfish");
    const sourceRoot = absolutePath("/extensions/source");
    const dependency = extensionDependencyApprovalIdentity({
      kind: "dependency",
      name: "tinyfish",
      version: "1.2.3",
    });
    store.recordExtensionDependencyReadiness({
      readiness: {
        extensionId: extensionIdValue,
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
    });
    store.recordExtensionDependencyApproval({
      dependency,
      approvedAt: isoDateTime("2026-04-18T09:00:03.000Z"),
      approvedBy: "user",
      sourceCommandId: commandId("cmd_dependency_approval_01"),
    });
    store.recordRuntimeSourceScan({
      scope: { kind: "app-global" },
      domain: "extensions",
      sourceFingerprint: "extensions-domain-fingerprint-01",
      sourceRoots: [
        {
          sourceRoot,
          rootFingerprint: "source-fingerprint-01",
        },
      ],
      diagnostics: [],
      scannedAt: isoDateTime(
        "2026-04-18T09:00:04.000Z",
      ) as RecordRuntimeSourceScanInput["scannedAt"],
    });

    const port = extensionStatePortFromStore(store);

    const readiness = await runTestEffect(
      port.dependencies.readReadiness({
        extensionId: extensionIdValue,
        requirementId: "dep:tinyfish",
      }),
    );
    const missing = await runTestEffect(
      port.dependencies.readReadiness({
        extensionId: extensionIdValue,
        requirementId: "dep:missing",
      }),
    );
    const sourceFingerprint = await runTestEffect(
      port.records.readSourceFingerprint({ sourceRoot }),
    );
    const missingSourceFingerprint = await runTestEffect(
      port.records.readSourceFingerprint({ sourceRoot: absolutePath("/extensions/missing") }),
    );
    const approved = await runTestEffect(
      port.dependencies.isApproved({
        dependency,
      }),
    );
    const missingApproval = await runTestEffect(
      port.dependencies.isApproved({
        dependency: extensionDependencyApprovalIdentity({
          kind: "dependency",
          name: "tinyfish",
          version: "9.9.9",
        }),
      }),
    );

    expect(readiness?.extensionId as string).toBe("ext_tinyfish");
    expect(readiness?.requirementId).toBe("dep:tinyfish");
    expect(readiness?.status).toBe("ready");
    expect(missing).toBeNull();
    expect(sourceFingerprint).toBe("source-fingerprint-01");
    expect(missingSourceFingerprint).toBeNull();
    expect(approved).toBe(true);
    expect(missingApproval).toBe(false);
  });

  it("requires complete dependency approval identity matches", async () => {
    const store = createStore();
    const dependency = extensionDependencyApprovalIdentity({
      kind: "dependency",
      name: "tinyfish",
      version: "1.2.3",
      integrity: "sha512-good",
      resolution: "https://registry.npmjs.org/tinyfish/-/tinyfish-1.2.3.tgz",
    });
    const first = store.recordExtensionDependencyApproval({
      dependency,
      approvedAt: isoDateTime("2026-04-18T09:00:03.000Z"),
      approvedBy: "user",
      sourceCommandId: commandId("cmd_dependency_approval_01"),
    });
    const second = store.recordExtensionDependencyApproval({
      dependency,
      approvedAt: isoDateTime("2026-04-18T09:00:04.000Z"),
      approvedBy: "user",
      sourceCommandId: commandId("cmd_dependency_approval_02"),
    });
    const port = extensionStatePortFromStore(store);

    expect(first.createdAt).toBe("2026-04-18T09:00:03.000Z");
    expect(second.createdAt).toBe("2026-04-18T09:00:03.000Z");
    expect(second.updatedAt).toBe("2026-04-18T09:00:04.000Z");
    expect(second.sourceCommandId as string).toBe("cmd_dependency_approval_02");
    await expectApproved(port, dependency, true);
    await expectApproved(
      port,
      extensionDependencyApprovalIdentity({
        kind: "dependency",
        name: "tinyfish",
        version: "1.2.3",
      }),
      false,
    );
    await expectApproved(
      port,
      extensionDependencyApprovalIdentity({
        kind: "dependency",
        name: "tinyfish",
        version: "1.2.3",
        integrity: "sha512-other",
        resolution: dependency.resolution,
      }),
      false,
    );
    await expectApproved(
      port,
      extensionDependencyApprovalIdentity({
        kind: "dependency",
        name: "tinyfish",
        version: "1.2.3",
        integrity: dependency.integrity,
        resolution: "https://registry.npmjs.org/tinyfish/-/tinyfish-1.2.3-other.tgz",
      }),
      false,
    );
    await expectApproved(
      port,
      extensionDependencyApprovalIdentity({
        kind: "trusted_dependency",
        name: "tinyfish",
        version: "1.2.3",
        integrity: dependency.integrity,
        resolution: dependency.resolution,
      }),
      false,
    );
  });
});

async function expectApproved(
  port: ReturnType<typeof extensionStatePortFromStore>,
  dependency: ExtensionDependencyApprovalIdentity,
  expected: boolean,
) {
  await expect(
    runTestEffect(
      port.dependencies.isApproved({
        dependency,
      }),
    ),
  ).resolves.toBe(expected);
}
