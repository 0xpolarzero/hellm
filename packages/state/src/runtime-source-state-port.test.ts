import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  discoveredHostSnippetId,
  RuntimeSourceStatePort,
  StateContractError,
  type AbsolutePath,
  type CommandId,
  type ExtensionId,
  type RecordRuntimeSourceDeleteInput,
  type RecordRuntimeSourceSaveInput,
  type RuntimeSourceFactRecord,
  type RuntimeSourceScanFactRecord,
  type WorkflowAgentSourceObservation,
  type WorkspaceId,
} from "@svvy/core";
import { layerRuntimeSourceStatePort } from "./index";
import { runtimeSourceStatePortFromStore } from "./structured-session-adapters";
import {
  createStructuredSessionStateStore,
  layerStructuredSessionState,
} from "./structured-session-state";
import { runTestEffect } from "./effect.test-support";

const workspace = {
  id: "workspace_runtime_source_state_port",
  cwd: "/tmp/svvy-runtime-source-state-port",
  label: "Runtime source state port",
};

const path = (value: string) => value as AbsolutePath;
const savedAt = (value: string) => value as RecordRuntimeSourceSaveInput["savedAt"];
const deletedAt = (value: string) => value as RecordRuntimeSourceDeleteInput["deletedAt"];
const factDeletedAt = (value: string) => value as RuntimeSourceFactRecord["deletedAt"];
const observedAt = (value: string) => value as RuntimeSourceScanFactRecord["observedAt"];
const workflowObservedAt = (value: string) => value as WorkflowAgentSourceObservation["observedAt"];
const brandedWorkspaceId = workspace.id as WorkspaceId;

describe("RuntimeSourceStatePort", () => {
  it("atomically saves, deletes, and reconciles the durable workflow-agent source index", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    const validObservation = {
      sourceId: "defaultAgent",
      path: path("/tmp/svvy-runtime-source-state-port/workflows/defaultAgent.agent.json"),
      sourceVersion: "sha256:default",
      fingerprint: "sha256:default",
      validationStatus: "valid",
      diagnostics: [],
      parameters: {
        id: "defaultAgent",
        label: "Default agent",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructions: "Implement the task.",
      },
      extensionOrder: ["shell" as ExtensionId],
      observedAt: workflowObservedAt("2026-07-11T08:00:00.000Z"),
    } satisfies WorkflowAgentSourceObservation;
    const beforeSaveRevision = store.readCurrentStateRevision() as number;
    const saved = await runTestEffect(
      port.recordWorkflowAgentSourceSave({
        source: {
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: validObservation.sourceId,
          path: validObservation.path,
          sourceVersion: validObservation.sourceVersion,
          fingerprint: validObservation.fingerprint,
          diagnostics: validObservation.diagnostics,
          savedAt: validObservation.observedAt,
        },
        observation: validObservation,
      }),
    );

    expect(store.readCurrentStateRevision() as number).toBe(beforeSaveRevision + 1);
    expect(saved.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "agents" } },
      { scope: "app", invalidation: { model: "workflowsGenerated" } },
    ]);
    expect(store.listCurrentWorkflowAgentSources()).toEqual([
      expect.objectContaining({
        sourceId: "defaultAgent",
        validationStatus: "valid",
        parameters: expect.objectContaining({ id: "defaultAgent" }),
      }),
    ]);

    const beforeDeleteRevision = store.readCurrentStateRevision() as number;
    const deletedAtValue = deletedAt("2026-07-11T08:01:00.000Z");
    await runTestEffect(
      port.recordWorkflowAgentSourceDelete({
        source: {
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: validObservation.sourceId,
          path: validObservation.path,
          previousSourceVersion: validObservation.sourceVersion,
          previousFingerprint: validObservation.fingerprint,
          deletedAt: deletedAtValue,
        },
      }),
    );
    expect(store.readCurrentStateRevision() as number).toBe(beforeDeleteRevision + 1);
    expect(store.listCurrentWorkflowAgentSources()).toEqual([]);

    const invalidObservation = {
      sourceId: "invalid-agent-name!",
      path: path("/tmp/svvy-runtime-source-state-port/workflows/invalid-agent-name!.agent.json"),
      sourceVersion: "sha256:invalid",
      fingerprint: "sha256:invalid",
      validationStatus: "invalid",
      diagnostics: [
        {
          severity: "error",
          code: "workflow_agent_source_invalid",
          message: "Workflow-agent source filename is not a valid export name.",
        },
      ],
      parameters: null,
      extensionOrder: [],
      observedAt: workflowObservedAt("2026-07-11T08:02:00.000Z"),
    } satisfies WorkflowAgentSourceObservation;
    const rescannedValidObservation = {
      ...validObservation,
      observedAt: invalidObservation.observedAt,
    } satisfies WorkflowAgentSourceObservation;
    const beforeReconcileRevision = store.readCurrentStateRevision() as number;
    const reconciled = await runTestEffect(
      port.reconcileWorkflowAgentSources({
        sourceFingerprint: "sha256:workflow-scan-1",
        observations: [rescannedValidObservation, invalidObservation],
        diagnostics: [],
        scannedAt: invalidObservation.observedAt,
      }),
    );
    expect(store.readCurrentStateRevision() as number).toBe(beforeReconcileRevision + 1);
    expect(reconciled.afterCommit).toEqual([
      { scope: "app", invalidation: { model: "agents" } },
      { scope: "app", invalidation: { model: "workflowsGenerated" } },
    ]);
    expect(store.listCurrentWorkflowAgentSources()).toEqual([
      expect.objectContaining({ sourceId: "defaultAgent", validationStatus: "valid" }),
      expect.objectContaining({
        sourceId: "invalid-agent-name!",
        validationStatus: "invalid",
        parameters: null,
      }),
    ]);

    const secondScanAt = workflowObservedAt("2026-07-11T08:03:00.000Z");
    const beforeSecondReconcileRevision = store.readCurrentStateRevision() as number;
    await runTestEffect(
      port.reconcileWorkflowAgentSources({
        sourceFingerprint: "sha256:workflow-scan-2",
        observations: [{ ...rescannedValidObservation, observedAt: secondScanAt }],
        diagnostics: [],
        scannedAt: secondScanAt,
      }),
    );
    expect(store.readCurrentStateRevision() as number).toBe(beforeSecondReconcileRevision + 1);
    expect(store.listCurrentWorkflowAgentSources().map((source) => source.sourceId)).toEqual([
      "defaultAgent",
    ]);
    expect(
      await runTestEffect(
        port.readSourceVersion({
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: invalidObservation.sourceId,
        }),
      ),
    ).toMatchObject({ deletedAt: secondScanAt });
    store.close();
  });

  it("records, reads, updates, deletes, and persists source facts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svvy-source-port-"));
    const databasePath = join(dir, "state.sqlite");
    try {
      const store = createStructuredSessionStateStore({ databasePath, workspace });
      const port = runtimeSourceStatePortFromStore(store);
      const saved = await runTestEffect(
        port.recordSourceSave({
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
          path: path("/tmp/svvy-runtime-source-state-port/.smithers/reviewer.agent.json"),
          sourceVersion: "version_01",
          fingerprint: "fingerprint_01",
          diagnostics: [],
          savedAt: savedAt("2026-04-18T10:00:00.000Z"),
        }),
      );
      const updated = await runTestEffect(
        port.recordSourceSave({
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
          path: path("/tmp/svvy-runtime-source-state-port/.smithers/reviewer.agent.json"),
          previousSourceVersion: "version_01",
          sourceVersion: "version_02",
          fingerprint: "fingerprint_02",
          diagnostics: [{ severity: "warning", message: "Check model.", code: "MODEL" }],
          sourceCommandId: "command-source-save" as CommandId,
          savedAt: savedAt("2026-04-18T10:01:00.000Z"),
        }),
      );
      const deleted = await runTestEffect(
        port.recordSourceDelete({
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
          path: path("/tmp/svvy-runtime-source-state-port/.smithers/reviewer.agent.json"),
          previousSourceVersion: "version_02",
          previousFingerprint: "fingerprint_02",
          deletedAt: deletedAt("2026-04-18T10:02:00.000Z"),
        }),
      );
      store.close();

      const reopened = createStructuredSessionStateStore({ databasePath, workspace });
      const reopenedPort = runtimeSourceStatePortFromStore(reopened);
      const read = await runTestEffect(
        reopenedPort.readSourceVersion({
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: "agent-reviewer",
        }),
      );
      reopened.close();

      expect(saved.afterCommit).toEqual([
        { scope: "app", invalidation: { model: "agents" } },
        { scope: "app", invalidation: { model: "workflowsGenerated" } },
      ]);
      expect(updated.value).toMatchObject({
        scope: { kind: "app-global" },
        scopeKey: "app-global",
        sourceVersion: "version_02",
        fingerprint: "fingerprint_02",
        sourceCommandId: "command-source-save",
        deletedAt: null,
      });
      expect(deleted.value.deletedAt).toBe(factDeletedAt("2026-04-18T10:02:00.000Z"));
      expect(read).toMatchObject({
        sourceKind: "workflow-agent",
        sourceId: "agent-reviewer",
        sourceVersion: "version_02",
        deletedAt: factDeletedAt("2026-04-18T10:02:00.000Z"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects stale source save versions through the typed state error boundary", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    await runTestEffect(
      port.recordSourceSave({
        scope: { kind: "app-global" },
        sourceKind: "user-extension",
        sourceId: "extension-a",
        path: path("/tmp/svvy-runtime-source-state-port/extensions/a.mdx"),
        sourceVersion: "version_01",
        fingerprint: "fingerprint_01",
        diagnostics: [],
        savedAt: savedAt("2026-04-18T11:00:00.000Z"),
      }),
    );

    await expect(
      runTestEffect(
        port.recordSourceSave({
          scope: { kind: "app-global" },
          sourceKind: "user-extension",
          sourceId: "extension-a",
          path: path("/tmp/svvy-runtime-source-state-port/extensions/a.mdx"),
          previousSourceVersion: "version_missing",
          sourceVersion: "version_02",
          fingerprint: "fingerprint_02",
          diagnostics: [],
          savedAt: savedAt("2026-04-18T11:01:00.000Z"),
        }),
      ),
    ).rejects.toBeInstanceOf(StateContractError);
    store.close();
  });

  it("makes source save and delete recovery retries idempotent without accepting divergence", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    await runTestEffect(
      port.recordSourceSave({
        scope: { kind: "app-global" },
        sourceKind: "workflow-agent",
        sourceId: "reviewerCopy",
        path: path("/tmp/svvy-runtime-source-state-port/workflows/reviewerCopy.agent.json"),
        sourceVersion: "version_01",
        fingerprint: "fingerprint_01",
        diagnostics: [],
        savedAt: savedAt("2026-04-18T11:10:00.000Z"),
      }),
    );
    const saveRetryInput = {
      scope: { kind: "app-global" as const },
      sourceKind: "workflow-agent" as const,
      sourceId: "reviewerCopy",
      path: path("/tmp/svvy-runtime-source-state-port/workflows/reviewerCopy.agent.json"),
      previousSourceVersion: "version_01",
      sourceVersion: "version_02",
      fingerprint: "fingerprint_02",
      diagnostics: [{ severity: "info" as const, message: "Validated." }],
      sourceCommandId: "command-source-retry" as CommandId,
      savedAt: savedAt("2026-04-18T11:11:00.000Z"),
    } satisfies RecordRuntimeSourceSaveInput;
    const saved = await runTestEffect(port.recordSourceSave(saveRetryInput));
    const retriedSave = await runTestEffect(port.recordSourceSave(saveRetryInput));

    expect(retriedSave.value).toEqual(saved.value);
    await expect(
      runTestEffect(
        port.recordSourceSave({
          ...saveRetryInput,
          sourceVersion: "version_03",
          fingerprint: "fingerprint_03",
          savedAt: savedAt("2026-04-18T11:12:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ reason: "stale-state" });

    const deleteRetryInput = {
      scope: { kind: "app-global" as const },
      sourceKind: "workflow-agent" as const,
      sourceId: "reviewerCopy",
      path: saveRetryInput.path,
      previousSourceVersion: "version_02",
      previousFingerprint: "fingerprint_02",
      sourceCommandId: "command-source-retry" as CommandId,
      deletedAt: deletedAt("2026-04-18T11:13:00.000Z"),
    } satisfies RecordRuntimeSourceDeleteInput;
    const deleted = await runTestEffect(port.recordSourceDelete(deleteRetryInput));
    const retriedDelete = await runTestEffect(port.recordSourceDelete(deleteRetryInput));

    expect(retriedDelete.value).toEqual(deleted.value);
    await expect(
      runTestEffect(
        port.recordSourceDelete({
          ...deleteRetryInput,
          previousFingerprint: "fingerprint_diverged",
          deletedAt: deletedAt("2026-04-18T11:14:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ reason: "stale-state" });
    store.close();
  });

  it("upserts a deletion tombstone when no editable source fact exists yet", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    const deleted = await runTestEffect(
      port.recordSourceDelete({
        scope: { kind: "app-global" },
        sourceKind: "workflow-agent",
        sourceId: "preexistingAgent",
        path: path("/tmp/svvy-runtime-source-state-port/workflows/preexistingAgent.agent.json"),
        previousSourceVersion: "sha256:preexisting",
        previousFingerprint: "sha256:preexisting",
        deletedAt: deletedAt("2026-04-18T11:20:00.000Z"),
      }),
    );

    expect(deleted.value).toMatchObject({
      sourceKind: "workflow-agent",
      sourceId: "preexistingAgent",
      path: "/tmp/svvy-runtime-source-state-port/workflows/preexistingAgent.agent.json",
      sourceVersion: "sha256:preexisting",
      fingerprint: "sha256:preexisting",
      diagnostics: [],
      deletedAt: factDeletedAt("2026-04-18T11:20:00.000Z"),
    });
    store.close();
  });

  it("keeps low-level editable source facts distinct by explicit scope", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    await runTestEffect(
      port.recordSourceSave({
        scope: { kind: "app-global" },
        sourceKind: "user-extension",
        sourceId: "shared-extension",
        path: path("/tmp/svvy-runtime-source-state-port/extensions/shared.mdx"),
        sourceVersion: "app_version",
        fingerprint: "app_fingerprint",
        diagnostics: [],
        savedAt: savedAt("2026-04-18T12:10:00.000Z"),
      }),
    );
    await runTestEffect(
      port.recordSourceSave({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        sourceKind: "user-extension",
        sourceId: "shared-extension",
        path: path("/tmp/svvy-runtime-source-state-port/workspace/shared.mdx"),
        sourceVersion: "workspace_version",
        fingerprint: "workspace_fingerprint",
        diagnostics: [],
        savedAt: savedAt("2026-04-18T12:11:00.000Z"),
      }),
    );

    const appFact = await runTestEffect(
      port.readSourceVersion({
        scope: { kind: "app-global" },
        sourceKind: "user-extension",
        sourceId: "shared-extension",
      }),
    );
    const workspaceFact = await runTestEffect(
      port.readSourceVersion({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        sourceKind: "user-extension",
        sourceId: "shared-extension",
      }),
    );

    expect(appFact).toMatchObject({
      scope: { kind: "app-global" },
      scopeKey: "app-global",
      sourceVersion: "app_version",
    });
    expect(workspaceFact).toMatchObject({
      scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
      scopeKey: `workspace:${workspace.id}`,
      sourceVersion: "workspace_version",
    });
    store.close();
  });

  it("records source scan, deletion, and diagnostic facts for runtime reconciliation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "svvy-source-port-"));
    const databasePath = join(dir, "state.sqlite");
    try {
      const store = createStructuredSessionStateStore({ databasePath, workspace });
      const port = runtimeSourceStatePortFromStore(store);
      const appScan = await runTestEffect(
        port.recordSourceScan({
          scope: { kind: "app-global" },
          domain: "extensions",
          sourceFingerprint: "extensions_fingerprint_01",
          sourceRoots: [
            {
              sourceRoot: path("/tmp/svvy-runtime-source-state-port/extensions/sources/user/web"),
              rootFingerprint: "web_source_fingerprint_01",
            },
          ],
          diagnostics: [],
          scannedAt: observedAt("2026-04-18T13:00:00.000Z"),
        }),
      );
      const workspaceDeletion = await runTestEffect(
        port.recordObservedSourceDeletion({
          scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
          domain: "host_snippets",
          path: path("/tmp/svvy-runtime-source-state-port/.claude/commands/old.md"),
          diagnostics: [{ severity: "warning", message: "Snippet disappeared.", code: "MISSING" }],
          observedAt: observedAt("2026-04-18T13:01:00.000Z"),
        }),
      );
      store.close();

      const reopened = createStructuredSessionStateStore({ databasePath, workspace });
      const reopenedRootFingerprint = reopened.readRuntimeSourceRootFingerprint({
        sourceRoot: path("/tmp/svvy-runtime-source-state-port/extensions/sources/user/web"),
      });
      const reopenedPort = runtimeSourceStatePortFromStore(reopened);
      const diagnostic = await runTestEffect(
        reopenedPort.recordSourceDiagnostic({
          scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
          domain: "host_snippets",
          path: path("/tmp/svvy-runtime-source-state-port/.claude/commands/new.md"),
          diagnostic: { severity: "error", message: "Snippet parse failed.", code: "PARSE" },
          observedAt: observedAt("2026-04-18T13:02:00.000Z"),
        }),
      );
      const missingRootFingerprint = reopened.readRuntimeSourceRootFingerprint({
        sourceRoot: path("/tmp/svvy-runtime-source-state-port/extensions/sources/user/missing"),
      });
      reopened.close();

      expect(appScan.value).toMatchObject({
        scope: { kind: "app-global" },
        scopeKey: "app-global",
        domain: "extensions",
        sourceFingerprint: "extensions_fingerprint_01",
        lastObservationKind: "scan",
      });
      expect(appScan.afterCommit).toEqual([
        { scope: "app", invalidation: { model: "extensions" } },
      ]);
      expect(reopenedRootFingerprint).toMatchObject({
        scope: { kind: "app-global" },
        scopeKey: "app-global",
        domain: "extensions",
        rootFingerprint: "web_source_fingerprint_01",
      });
      expect(missingRootFingerprint).toBeNull();
      expect(workspaceDeletion.value).toMatchObject({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        scopeKey: `workspace:${workspace.id}`,
        domain: "host_snippets",
        sourceFingerprint: "unresolved:host_snippets",
        lastObservedPath: path("/tmp/svvy-runtime-source-state-port/.claude/commands/old.md"),
        lastObservationKind: "deletion",
      });
      expect(workspaceDeletion.afterCommit).toEqual([
        {
          scope: "workspace",
          workspaceId: brandedWorkspaceId,
          invalidation: { model: "snippets" },
        },
      ]);
      expect(diagnostic.value.diagnostics.map((item) => item.code)).toEqual(["MISSING", "PARSE"]);
      expect(diagnostic.value.lastObservationKind).toBe("diagnostic");
      expect(diagnostic.afterCommit).toEqual([
        {
          scope: "workspace",
          workspaceId: brandedWorkspaceId,
          invalidation: { model: "snippets" },
        },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("atomically reconciles discovered host snippets while preserving user enablement", async () => {
    const store = createStructuredSessionStateStore({ workspace });
    const port = runtimeSourceStatePortFromStore(store);
    const managed = store.createManagedSnippet({
      workspaceId: workspace.id as WorkspaceId,
      title: "Managed review",
      body: "Managed body",
      metadata: { description: null, argumentHint: null },
      enabled: true,
    });
    const claudePath = path(`${workspace.cwd}/.claude/commands/review.md`);
    const piPath = path(`${workspace.cwd}/.pi/prompts/plan.md`);
    const claudeId = discoveredHostSnippetId({
      source: "claude",
      scope: "workspace",
      path: claudePath,
    });

    const first = await runTestEffect(
      port.reconcileDiscoveredHostSnippets({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        sourceFingerprint: "host_snippets_fingerprint_01",
        sourceRoots: [
          {
            sourceRoot: path(`${workspace.cwd}/.claude/commands`),
            rootFingerprint: "claude_root_01",
          },
          {
            sourceRoot: path(`${workspace.cwd}/.pi/prompts`),
            rootFingerprint: "pi_root_01",
          },
        ],
        observedSnippets: [
          {
            source: "claude",
            scope: "workspace",
            path: claudePath,
            title: "review",
            body: "Review $1",
            metadata: { description: "Review a change", argumentHint: "path" },
          },
          {
            source: "pi",
            scope: "workspace",
            path: piPath,
            title: "plan",
            body: "Plan this",
            metadata: { description: null, argumentHint: null },
          },
        ],
        unreadableSnippets: [],
        unreadableRoots: [],
        diagnostics: [],
        scannedAt: observedAt("2026-04-18T14:00:00.000Z"),
      }),
    );
    store.setSnippetEnabled({
      workspaceId: brandedWorkspaceId,
      snippetId: claudeId,
      enabled: false,
    });

    const unreadable = await runTestEffect(
      port.reconcileDiscoveredHostSnippets({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        sourceFingerprint: "host_snippets_fingerprint_02",
        sourceRoots: [
          {
            sourceRoot: path(`${workspace.cwd}/.claude/commands`),
            rootFingerprint: "claude_root_unreadable",
          },
          {
            sourceRoot: path(`${workspace.cwd}/.pi/prompts`),
            rootFingerprint: "pi_root_missing",
          },
        ],
        observedSnippets: [],
        unreadableSnippets: [{ source: "claude", scope: "workspace", path: claudePath }],
        unreadableRoots: [],
        diagnostics: [
          {
            severity: "error",
            code: "host_snippet.file_unreadable",
            message: "Host snippet could not be read.",
            path: claudePath,
          },
        ],
        scannedAt: observedAt("2026-04-18T14:01:00.000Z"),
      }),
    );
    expect(store.listSnippets({ workspaceId: workspace.id })).toMatchObject([
      { id: claudeId, source: "claude", body: "Review $1", enabled: false },
      { id: managed.id, source: "svvy", body: "Managed body", enabled: true },
    ]);

    await runTestEffect(
      port.reconcileDiscoveredHostSnippets({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        sourceFingerprint: "host_snippets_fingerprint_03",
        sourceRoots: [],
        observedSnippets: [],
        unreadableSnippets: [],
        unreadableRoots: [],
        diagnostics: [],
        scannedAt: observedAt("2026-04-18T14:02:00.000Z"),
      }),
    );
    expect(store.listSnippets({ workspaceId: workspace.id })).toMatchObject([
      { id: managed.id, source: "svvy", body: "Managed body", enabled: true },
    ]);

    await runTestEffect(
      port.reconcileDiscoveredHostSnippets({
        scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
        sourceFingerprint: "host_snippets_fingerprint_04",
        sourceRoots: [],
        observedSnippets: [
          {
            source: "claude",
            scope: "workspace",
            path: claudePath,
            title: "review",
            body: "Review the updated $1",
            metadata: { description: null, argumentHint: "path" },
          },
        ],
        unreadableSnippets: [],
        unreadableRoots: [],
        diagnostics: [],
        scannedAt: observedAt("2026-04-18T14:03:00.000Z"),
      }),
    );

    expect(first.afterCommit).toEqual([
      {
        scope: "workspace",
        workspaceId: brandedWorkspaceId,
        invalidation: { model: "snippets" },
      },
    ]);
    expect(unreadable.value.diagnostics).toMatchObject([
      { code: "host_snippet.file_unreadable", path: claudePath },
    ]);
    expect(store.listSnippets({ workspaceId: workspace.id })).toMatchObject([
      {
        id: claudeId,
        source: "claude",
        body: "Review the updated $1",
        enabled: false,
      },
      { id: managed.id, source: "svvy", body: "Managed body", enabled: true },
    ]);
    expect(
      store.readRuntimeSourceRootFingerprint({
        sourceRoot: path(`${workspace.cwd}/.claude/commands`),
      }),
    ).toMatchObject({
      domain: "host_snippets",
      rootFingerprint: "claude_root_unreadable",
      diagnostics: [{ code: "host_snippet.file_unreadable" }],
    });
    store.close();
  });

  it("rolls back host snippet rows and scan facts when a discovered identity collides", async () => {
    const collisionPath = path(`${workspace.cwd}/.claude/commands/collision.md`);
    const collisionId = discoveredHostSnippetId({
      source: "claude",
      scope: "workspace",
      path: collisionPath,
    });
    const store = createStructuredSessionStateStore({
      workspace,
      idFactory: () => collisionId,
    });
    store.createManagedSnippet({
      workspaceId: workspace.id as WorkspaceId,
      title: "Managed collision",
      body: "Do not mutate",
      metadata: { description: null, argumentHint: null },
      enabled: true,
    });
    const revisionBefore = store.readCurrentStateRevision();
    const port = runtimeSourceStatePortFromStore(store);

    await expect(
      runTestEffect(
        port.reconcileDiscoveredHostSnippets({
          scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
          sourceFingerprint: "host_snippets_collision",
          sourceRoots: [],
          observedSnippets: [
            {
              source: "claude",
              scope: "workspace",
              path: collisionPath,
              title: "collision",
              body: "External body",
              metadata: { description: null, argumentHint: null },
            },
          ],
          unreadableSnippets: [],
          unreadableRoots: [],
          diagnostics: [],
          scannedAt: observedAt("2026-04-18T14:10:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ reason: "conflict" });

    expect(store.readCurrentStateRevision()).toBe(revisionBefore);
    expect(store.listSnippets({ workspaceId: workspace.id })).toMatchObject([
      { id: collisionId, source: "svvy", body: "Do not mutate" },
    ]);
    store.close();
  });

  it("rejects invalid source scan scope/domain pairs at the persistence boundary", () => {
    const dir = mkdtempSync(join(tmpdir(), "svvy-source-port-"));
    const databasePath = join(dir, "state.sqlite");
    const store = createStructuredSessionStateStore({ databasePath, workspace });
    try {
      expect(() =>
        store.recordRuntimeSourceScan({
          scope: { kind: "app-global" },
          domain: "host_snippets",
          sourceFingerprint: "snippet_fingerprint_01",
          diagnostics: [],
          scannedAt: observedAt("2026-04-18T13:00:00.000Z"),
        } as never),
      ).toThrow("app-global source scan cannot target host_snippets");

      expect(() =>
        store.recordObservedRuntimeSourceDeletion({
          scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
          domain: "extensions",
          path: path("/tmp/svvy-runtime-source-state-port/extensions/source.mdx"),
          diagnostics: [],
          observedAt: observedAt("2026-04-18T13:01:00.000Z"),
        } as never),
      ).toThrow("workspace source scan cannot target extensions");

      expect(() =>
        store.recordRuntimeSourceDiagnostic({
          scope: { kind: "workspace", workspaceId: brandedWorkspaceId },
          domain: "workflows",
          diagnostic: {
            severity: "error",
            message: "Workflow source is unreadable.",
            code: "workflow.unreadable",
          },
          observedAt: observedAt("2026-04-18T13:02:00.000Z"),
        } as never),
      ).toThrow("workspace source scan cannot target workflows");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exposes the source state port through a layer", async () => {
    await runTestEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const port = yield* RuntimeSourceStatePort;
          const result = yield* port.recordSourceSave({
            scope: { kind: "app-global" },
            sourceKind: "builtin-extension",
            sourceId: "base-orchestrator",
            path: path("/tmp/svvy-runtime-source-state-port/base-orchestrator.mdx"),
            sourceVersion: "version_01",
            fingerprint: "fingerprint_01",
            diagnostics: [],
            savedAt: savedAt("2026-04-18T12:00:00.000Z"),
          });
          expect(result.afterCommit).toEqual([
            { scope: "app", invalidation: { model: "extensions" } },
          ]);
        }).pipe(
          Effect.provide(
            layerRuntimeSourceStatePort.pipe(
              Layer.provideMerge(layerStructuredSessionState({ workspace })),
            ),
          ),
        ),
      ),
    );
  });
});
