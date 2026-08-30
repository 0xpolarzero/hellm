import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AbsolutePath,
  ExternalInstructionScanResult,
  ExternalInstructionSourceId,
  ExtensionId,
  WorkspaceId,
} from "@svvy/core";
import { appLogStateFromStore, createAppLogStore } from "./app-log-store";
import { runTestEffect } from "./effect.test-support";
import { runtimeExternalInstructionStatePortFromStore } from "./runtime-external-instruction-state-port";
import { stateReadModelsFromRouter } from "./state-facade";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createWorkspaceStateRouter } from "./workspace-state-router";

const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};
const workspaceId = "workspace_external_instruction_projection" as WorkspaceId;
const sourceId = (value: string) => value as ExternalInstructionSourceId;
const absolutePath = (value: string) => value as AbsolutePath;

function scan(
  inputs: readonly {
    id: ExternalInstructionSourceId;
    path: string;
    order: number;
    content?: string;
    unreadable?: boolean;
    defaultEnabled?: boolean;
  }[],
): ExternalInstructionScanResult {
  return {
    sources: inputs.map((input) => ({
      id: input.id,
      source: { sourceKind: "external-instruction", sourceId: input.id },
      fileName: input.path.endsWith("CLAUDE.md") ? "CLAUDE.md" : "AGENTS.md",
      title: input.path.endsWith("CLAUDE.md") ? "CLAUDE.md" : "AGENTS.md",
      canonicalPath: absolutePath(input.path),
      sourceGroup: "workspace_chain",
      order: input.order,
      enabled: input.defaultEnabled ?? true,
      eligibleActors: ["orchestrator", "handler", "workflow-task"],
      readOnly: true,
      contentHash: input.content ? `hash:${input.content}` : "",
      fingerprint: `fingerprint:${input.path}:${input.content ?? "unreadable"}`,
      readStatus: input.unreadable
        ? { status: "unreadable", error: `Cannot read ${input.path}` }
        : { status: "readable" },
    })),
    contents: inputs.flatMap((input) =>
      input.content === undefined ? [] : [{ sourceId: input.id, content: input.content }],
    ),
    diagnostics: inputs.flatMap((input) =>
      input.unreadable
        ? [
            {
              sourceId: input.id,
              severity: "error" as const,
              code: "external-instruction-unreadable",
              message: `Cannot read ${input.path}`,
            },
          ]
        : [],
    ),
  };
}

describe("runtime external instruction state port", () => {
  const stores: StructuredSessionStateStore[] = [];
  const tempDirs: string[] = [];

  afterEach(() => {
    while (stores.length > 0) stores.pop()?.close();
    while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  });

  function createStore(databasePath = ":memory:", id: WorkspaceId = workspaceId) {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-external-instruction-state-"));
    tempDirs.push(cwd);
    const store = createStructuredSessionStateStore({
      databasePath,
      digest: testDigest,
      workspace: { id, label: "workspace", cwd, artifactDir: join(cwd, "artifacts") },
      now: (() => {
        let time = Date.parse("2026-07-12T09:00:00.000Z");
        return () => new Date(time++).toISOString();
      })(),
    });
    stores.push(store);
    return store;
  }

  it("atomically reconciles, tombstones removed sources, and does not invalidate unchanged scans", async () => {
    const store = createStore();
    const port = runtimeExternalInstructionStatePortFromStore(store);
    const firstScan = scan([
      {
        id: sourceId("external:first"),
        path: "/workspace/AGENTS.md",
        order: 0,
        content: "First",
      },
      {
        id: sourceId("external:second"),
        path: "/workspace/CLAUDE.md",
        order: 1,
        content: "Second",
        defaultEnabled: false,
      },
    ]);

    const first = await runTestEffect(
      port.reconcileExternalInstructions({ workspaceId, scan: firstScan }),
    );
    expect(first.value.changed).toBe(true);
    expect(first.afterCommit).toEqual([
      { scope: "workspace", workspaceId, invalidation: { model: "externalInstructions" } },
    ]);
    expect(first.value.projection.sources).toEqual([
      expect.objectContaining({
        id: "external:first",
        content: "First",
        defaultControl: {
          enabled: true,
          eligibleActors: ["orchestrator", "handler", "workflow-task"],
        },
      }),
      expect.objectContaining({
        id: "external:second",
        content: "Second",
        defaultControl: {
          enabled: false,
          eligibleActors: ["orchestrator", "handler", "workflow-task"],
        },
      }),
    ]);
    const revision = first.value.projection.revision;
    const observedAt = first.value.projection.observedAt;

    const identical = await runTestEffect(
      port.reconcileExternalInstructions({ workspaceId, scan: firstScan }),
    );
    expect(identical).toMatchObject({
      value: { changed: false, projection: { revision, observedAt } },
      afterCommit: [],
    });

    const unreadableScan = scan([
      {
        id: sourceId("external:second"),
        path: "/workspace/CLAUDE.md",
        order: 0,
        unreadable: true,
        defaultEnabled: false,
      },
    ]);
    const reconciled = await runTestEffect(
      port.reconcileExternalInstructions({ workspaceId, scan: unreadableScan }),
    );
    expect(reconciled.value.changed).toBe(true);
    expect(reconciled.value.projection.sources).toEqual([
      expect.objectContaining({
        id: "external:second",
        order: 0,
        content: null,
        readStatus: { status: "unreadable", error: "Cannot read /workspace/CLAUDE.md" },
      }),
    ]);
    expect(reconciled.value.projection.diagnostics).toHaveLength(1);
    expect(Number(reconciled.value.projection.revision)).toBeGreaterThan(Number(revision));
  });

  it("joins profile and actor-default usage into the runtime read projection", async () => {
    const store = createStore();
    const port = runtimeExternalInstructionStatePortFromStore(store);
    await runTestEffect(
      port.reconcileExternalInstructions({
        workspaceId,
        scan: scan([
          {
            id: sourceId("external:profile"),
            path: "/workspace/AGENTS.md",
            order: 0,
            content: "Profile",
          },
          {
            id: sourceId("external:default"),
            path: "/workspace/CLAUDE.md",
            order: 1,
            content: "Default",
          },
        ]),
      }),
    );
    store.setAgentActorExtensionDefaults({
      actor: "orchestrator",
      extensionUsage: { "external:default": "loaded" },
      extensionOrder: [],
    });
    store.setExternalInstructionActorUsage({
      actor: "orchestrator",
      profileId: "default-orchestrator" as never,
      sourceId: sourceId("external:profile"),
      usage: "disabled",
    });

    const projection = await runTestEffect(port.readExternalInstructions({ workspaceId }));
    expect(projection.actorUsage).toEqual(
      expect.arrayContaining([
        {
          actor: "orchestrator",
          profileId: "default-orchestrator",
          sourceId: "external:profile",
          usage: "unavailable",
        },
        {
          actor: "orchestrator",
          profileId: null,
          sourceId: "external:default",
          usage: "loaded",
        },
      ]),
    );
  });

  it("survives reopen and rejects malformed content without changing the projection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svvy-external-instruction-reopen-"));
    tempDirs.push(dir);
    const databasePath = join(dir, "state.sqlite");
    const store = createStore(databasePath);
    const port = runtimeExternalInstructionStatePortFromStore(store);
    const initial = scan([
      {
        id: sourceId("external:persisted"),
        path: "/workspace/AGENTS.md",
        order: 0,
        content: "Persisted",
      },
    ]);
    await runTestEffect(port.reconcileExternalInstructions({ workspaceId, scan: initial }));
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopened = createStore(databasePath);
    const reopenedPort = runtimeExternalInstructionStatePortFromStore(reopened);
    expect(
      await runTestEffect(reopenedPort.readExternalInstructions({ workspaceId })),
    ).toMatchObject({ sources: [{ id: "external:persisted", content: "Persisted" }] });
    await expect(
      runTestEffect(
        reopenedPort.reconcileExternalInstructions({
          workspaceId,
          scan: {
            ...initial,
            contents: [
              ...initial.contents,
              { sourceId: sourceId("external:unknown"), content: "No owner" },
            ],
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-input" });
    expect(
      await runTestEffect(reopenedPort.readExternalInstructions({ workspaceId })),
    ).toMatchObject({ sources: [{ id: "external:persisted", content: "Persisted" }] });
  });

  it("routes fetch, invalidation refetch, and rebaseline through the workspace projection", async () => {
    const appStore = createStore(":memory:", "workspace_external_app" as WorkspaceId);
    const workspaceStore = createStore();
    const appLogs = createAppLogStore({
      digest: testDigest,
      now: () => "2026-07-12T10:00:00.000Z",
    });
    try {
      const scanResult = scan([
        {
          id: sourceId("external:routed"),
          path: "/workspace/AGENTS.md",
          order: 0,
          content: "Routed",
        },
      ]);
      await runTestEffect(
        runtimeExternalInstructionStatePortFromStore(workspaceStore).reconcileExternalInstructions({
          workspaceId,
          scan: scanResult,
        }),
      );
      appStore.setAgentActorExtensionDefaults({
        actor: "workflow-task",
        extensionUsage: { ["external:routed" as ExtensionId]: "loaded" },
        extensionOrder: ["external:routed" as ExtensionId],
      });
      const readModels = stateReadModelsFromRouter({
        router: createWorkspaceStateRouter({
          appGlobalStore: appStore,
          workspaceStores: [{ store: workspaceStore }],
        }),
        appLogs: appLogStateFromStore(appLogs),
      });

      const fetched = await runTestEffect(
        readModels.fetch({ kind: "externalInstructions", workspaceId }),
      );
      expect(fetched).toMatchObject({
        kind: "externalInstructions",
        value: {
          sources: [{ id: "external:routed", content: "Routed" }],
          actorUsage: [
            {
              actor: "workflow-task",
              profileId: null,
              sourceId: "external:routed",
              usage: "loaded",
            },
          ],
        },
      });
      const refetched = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: {
            scope: "workspace",
            workspaceId,
            invalidation: { model: "externalInstructions" },
          },
        }),
      );
      expect(refetched).toEqual([fetched]);
      const baseline = await runTestEffect(
        readModels.rebaseline({ workspaceId, reason: "renderer-startup" }),
      );
      expect(baseline.workspaces).toContainEqual(fetched);
    } finally {
      appLogs.close();
    }
  });
});
