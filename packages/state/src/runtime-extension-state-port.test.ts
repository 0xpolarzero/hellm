import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CommandId,
  ExtensionDependencyApprovalIdentity,
  ExtensionDependencyReadiness,
  ExtensionId,
  IsoDateTimeString,
} from "@svvy/core";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { runtimeExtensionStatePortFromStore } from "./runtime-extension-state-port";
import { runTestEffect } from "./effect.test-support";

const commandId = (value: string): CommandId => value as CommandId;
const extensionId = (value: string): ExtensionId => value as ExtensionId;
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

  it("records dependency readiness as product state and invalidates extensions", async () => {
    const store = createStore();
    const port = runtimeExtensionStatePortFromStore(store);

    const result = await runTestEffect(
      port.recordDependencyReadiness({
        readiness: {
          extensionId: extensionId("ext_tinyfish"),
          requirementId: "dep:tinyfish",
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
});
