import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AbsolutePath,
  CommandId,
  ExtensionDependencyReadiness,
  ExtensionId,
  IsoDateTimeString,
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

  it("reads dependency readiness from state and delegates approval/source reads to host overrides", async () => {
    const store = createStore();
    const extensionIdValue = extensionId("ext_tinyfish");
    store.recordExtensionDependencyReadiness({
      readiness: {
        extensionId: extensionIdValue,
        requirementId: "dep:tinyfish",
        status: "ready",
        detectedVersion: "1.2.3",
        expectedVersion: "1.2.3",
        diagnostics: [],
        checkedAt: checkedAt("2026-04-18T09:00:01.000Z"),
      },
      sourceCommandId: commandId("cmd_dependency_01"),
      recordedAt: isoDateTime("2026-04-18T09:00:02.000Z"),
    });

    const port = extensionStatePortFromStore(store, {
      records: {
        readSourceFingerprint: () => Effect.succeed("source-fingerprint-01"),
      },
      dependencies: {
        isApproved: () => Effect.succeed(true),
      },
    });

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
      port.records.readSourceFingerprint({ sourceRoot: absolutePath("/extensions/source") }),
    );
    const approved = await runTestEffect(
      port.dependencies.isApproved({
        dependency: {
          kind: "dependency",
          packageManager: "bun",
          source: "npm",
          name: "tinyfish",
          version: "1.2.3",
          integrity: null,
          resolution: null,
        },
      }),
    );

    expect(readiness?.extensionId as string).toBe("ext_tinyfish");
    expect(readiness?.requirementId).toBe("dep:tinyfish");
    expect(readiness?.status).toBe("ready");
    expect(missing).toBeNull();
    expect(sourceFingerprint).toBe("source-fingerprint-01");
    expect(approved).toBe(true);
  });
});
