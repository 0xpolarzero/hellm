import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  StateContractError,
  type AbsolutePath,
  type ExtensionId,
  type ExtensionRegistryObservationResult,
  type IsoDateTimeString,
  type WorkflowAgentSourceObservation,
  type WorkspaceId,
} from "@svvy/core";
import { generatedContextPreviewSubjectStatePortFromStore } from "./structured-session-adapters";
import { createStructuredSessionStateStore } from "./structured-session-state";
import { createWorkspaceStateRouter } from "./workspace-state-router";
import { runTestEffect } from "./effect.test-support";
import { extensionUsageStatePortFromStore } from "./extension-usage-state-port";

const extensionId = (value: string) => value as ExtensionId;
const observedAt = (value: string) => value as IsoDateTimeString;

function registry(): ExtensionRegistryObservationResult {
  const records = [
    ["base", "loaded"],
    ["tools", "available"],
    ["network", "loaded"],
  ] as const;
  return {
    aggregateFingerprint: "sha256:preview-registry-v1",
    observations: records.map(([id, usage], canonicalOrder) => ({
      extensionId: extensionId(id),
      category: "builtin" as const,
      interfaceKind: "instructions" as const,
      svvyxImplementation: null,
      usagePolicy: {
        canonicalOrder,
        baselineUsage: {
          orchestrator: usage,
          handler: usage,
          "workflow-task": usage,
        },
        networkAccess: id === "network" ? ("required" as const) : ("not-required" as const),
        configurable: true,
        fixedReason: null,
      },
      buildRequirement: "not-required" as const,
      title: id,
      description: `${id} extension`,
      customized: false,
      materializationPlan: null,
      capabilities: {
        resettable: true,
        deletable: false,
        typescriptApiEnabled: false,
        materializationRequired: false,
      },
      contributors: [],
      tooling: [],
      cliDeclarations: [],
      envDeclarations: [],
      dependencyDeclarations: [],
      sourceFingerprint: `sha256:${id}`,
      diagnostics: [],
    })),
    diagnostics: [],
  };
}

function workflowAgent(): WorkflowAgentSourceObservation {
  return {
    sourceId: "reviewerAgent",
    path: "/tmp/workflows/reviewerAgent.agent.json" as AbsolutePath,
    sourceVersion: "sha256:workflow-reviewer-v1",
    fingerprint: "sha256:workflow-reviewer-v1",
    validationStatus: "valid",
    diagnostics: [],
    parameters: {
      id: "reviewerAgent",
      label: "Reviewer",
      provider: "anthropic",
      model: "claude-opus-4-6",
      reasoning: { effort: "high" },
      instructions: "Review the implementation carefully.",
      overrides: { tools: "loaded" },
    },
    extensionOrder: [extensionId("tools"), extensionId("base"), extensionId("network")],
    observedAt: "2026-07-12T09:05:00.000Z" as WorkflowAgentSourceObservation["observedAt"],
  };
}

describe("GeneratedContextPreviewSubjectStatePort", () => {
  it("reopens configured profiles and valid workflow-agent subjects with exact registry partitions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "svvy-preview-subject-"));
    const databasePath = join(cwd, "state.sqlite");
    const workspace = {
      id: "workspace_preview_subject",
      label: "Preview subject",
      cwd,
      artifactDir: join(cwd, "artifacts"),
    };
    let store = createStructuredSessionStateStore({ databasePath, workspace });
    try {
      store.reconcileExtensionRegistryObservation({
        observation: registry(),
        observedAt: observedAt("2026-07-12T09:00:00.000Z"),
      });
      store.updateAppPreferences({ networkAccess: false });
      store.setAgentActorExtensionDefaults({
        actor: "orchestrator",
        extensionUsage: { [extensionId("tools")]: "loaded" },
        extensionOrder: [extensionId("tools"), extensionId("base"), extensionId("network")],
      });
      store.updateOrchestratorProfile({
        profile: {
          profileId: "review-profile" as never,
          name: "Review profile",
          providerId: "openai" as never,
          modelId: "gpt-5.4" as never,
          reasoning: { effort: "xhigh" },
          followComposer: false,
          extensionUsage: { [extensionId("base")]: "available" },
          extensionOrder: [],
        },
      });
      const observation = workflowAgent();
      store.recordRuntimeWorkflowAgentSourceSave({
        source: {
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: observation.sourceId,
          path: observation.path,
          sourceVersion: observation.sourceVersion,
          fingerprint: observation.fingerprint,
          diagnostics: observation.diagnostics,
          savedAt: observation.observedAt,
        },
        observation,
      });
      store.close();
      store = createStructuredSessionStateStore({ databasePath, workspace });

      const port = generatedContextPreviewSubjectStatePortFromStore(store);
      const profile = await runTestEffect(
        port.readSubject({
          workspaceId: workspace.id as WorkspaceId,
          subject: {
            kind: "configured-profile",
            actorKind: "orchestrator",
            profileId: "review-profile" as never,
          },
        }),
      );
      expect(profile as unknown).toEqual({
        workspaceId: workspace.id,
        subject: {
          kind: "configured-profile",
          actorKind: "orchestrator",
          profileId: "review-profile",
        },
        profileId: "review-profile",
        profileName: "Review profile",
        providerId: "openai",
        modelId: "gpt-5.4",
        reasoningEffort: "xhigh",
        actorBinding: {
          actorKind: "orchestrator",
          loadedExtensionIds: ["tools"],
          availableExtensionIds: ["base"],
          unavailableExtensionIds: ["network"],
          instructionOrder: ["tools", "base", "network"],
          source: "profile-default",
        },
      });

      const workflow = await runTestEffect(
        port.readSubject({
          workspaceId: workspace.id as WorkspaceId,
          subject: {
            kind: "workflow-agent",
            actorKind: "workflow-task",
            sourceId: "reviewerAgent",
          },
        }),
      );
      expect(workflow.actorBinding as unknown).toEqual({
        actorKind: "workflow-task",
        loadedExtensionIds: ["tools", "base"],
        availableExtensionIds: [],
        unavailableExtensionIds: ["network"],
        instructionOrder: ["tools", "base", "network"],
        source: "workflow-agent-source",
      });
      expect(workflow.workflowTaskInlineInstructions as unknown).toEqual({
        sourceRecordId: "workflow-agent:reviewerAgent",
        sourceVersion: "sha256:workflow-reviewer-v1",
        text: "Review the implementation carefully.",
      });

      const refreshedObservation = {
        ...observation,
        sourceVersion: "sha256:workflow-reviewer-v2" as never,
        fingerprint: "sha256:workflow-reviewer-v2" as never,
        parameters: {
          ...observation.parameters!,
          label: "Updated Reviewer",
          instructions: "Use the freshly committed workflow-agent source.",
          overrides: { tools: "available" as const },
        },
      };
      store.recordRuntimeWorkflowAgentSourceSave({
        source: {
          scope: { kind: "app-global" },
          sourceKind: "workflow-agent",
          sourceId: refreshedObservation.sourceId,
          path: refreshedObservation.path,
          sourceVersion: refreshedObservation.sourceVersion,
          fingerprint: refreshedObservation.fingerprint,
          diagnostics: refreshedObservation.diagnostics,
          savedAt: refreshedObservation.observedAt,
        },
        observation: refreshedObservation,
      });
      const usagePort = extensionUsageStatePortFromStore(store);
      const workflowTarget = await runTestEffect(usagePort.resolveTarget("reviewerAgent"));
      await runTestEffect(
        usagePort.set({
          clientRequestId: "runtime-client:workflow-preview-usage" as never,
          extensionId: extensionId("tools"),
          target: workflowTarget,
          usage: "unavailable",
        }),
      );
      const refreshed = await runTestEffect(
        port.readSubject({
          workspaceId: workspace.id as WorkspaceId,
          subject: {
            kind: "workflow-agent",
            actorKind: "workflow-task",
            sourceId: "reviewerAgent",
          },
        }),
      );
      expect(refreshed.profileName).toBe("Updated Reviewer");
      expect(refreshed.actorBinding.loadedExtensionIds).not.toContain(extensionId("tools"));
      expect(refreshed.actorBinding.availableExtensionIds).not.toContain(extensionId("tools"));
      expect(refreshed.actorBinding.unavailableExtensionIds).toContain(extensionId("tools"));
      expect(refreshed.workflowTaskInlineInstructions?.text).toBe(
        "Use the freshly committed workflow-agent source.",
      );
    } finally {
      store.close();
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("routes workspace previews to app-global subject authority and rejects unregistered workspaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-preview-routing-"));
    const appGlobal = createStructuredSessionStateStore({
      workspace: { id: "workspace_app_global", label: "App", cwd: join(root, "app") },
    });
    const workspace = createStructuredSessionStateStore({
      workspace: { id: "workspace_preview_a", label: "A", cwd: join(root, "a") },
    });
    try {
      appGlobal.reconcileExtensionRegistryObservation({
        observation: registry(),
        observedAt: observedAt("2026-07-12T09:00:00.000Z"),
      });
      appGlobal.updateThreadHandlerProfile({
        profile: {
          profileId: "thread-handler" as never,
          name: "Thread handler",
          providerId: "anthropic" as never,
          modelId: "claude-sonnet-4-6" as never,
          reasoning: { effort: "medium" },
          extensionUsage: {},
          extensionOrder: [],
        },
      });
      const router = createWorkspaceStateRouter({
        appGlobalStore: appGlobal,
        workspaceStores: [{ store: workspace, isDefaultWorkspace: true }],
      });
      const record = await runTestEffect(
        router.generatedContextPreviewSubject.readSubject({
          workspaceId: "workspace_preview_a" as WorkspaceId,
          subject: {
            kind: "configured-profile",
            actorKind: "handler",
            profileId: "thread-handler" as never,
          },
        }),
      );
      expect(String(record.workspaceId)).toBe("workspace_preview_a");
      expect(record.profileName).toBe("Thread handler");

      await expect(
        runTestEffect(
          router.generatedContextPreviewSubject.readSubject({
            workspaceId: "workspace_missing" as WorkspaceId,
            subject: {
              kind: "configured-profile",
              actorKind: "handler",
              profileId: "thread-handler" as never,
            },
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
    } finally {
      appGlobal.close();
      workspace.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails closed for missing, invalid, or stale subject configuration", async () => {
    const store = createStructuredSessionStateStore({
      workspace: { id: "workspace_preview_invalid", label: "Invalid", cwd: "/tmp/invalid" },
    });
    try {
      store.reconcileExtensionRegistryObservation({
        observation: registry(),
        observedAt: observedAt("2026-07-12T09:00:00.000Z"),
      });
      store.updateOrchestratorProfile({
        profile: {
          profileId: "stale-profile" as never,
          name: "Stale",
          providerId: "openai" as never,
          modelId: "gpt-5.4" as never,
          reasoning: { effort: "high" },
          followComposer: false,
          extensionUsage: { [extensionId("removed")]: "loaded" },
          extensionOrder: [],
        },
      });
      const port = generatedContextPreviewSubjectStatePortFromStore(store);
      await expect(
        runTestEffect(
          port.readSubject({
            workspaceId: "workspace_preview_invalid" as WorkspaceId,
            subject: {
              kind: "configured-profile",
              actorKind: "orchestrator",
              profileId: "stale-profile" as never,
            },
          }),
        ),
      ).rejects.toMatchObject({ reason: "conflict" });
      await expect(
        runTestEffect(
          port.readSubject({
            workspaceId: "workspace_preview_invalid" as WorkspaceId,
            subject: {
              kind: "workflow-agent",
              actorKind: "workflow-task",
              sourceId: "missingAgent",
            },
          }),
        ),
      ).rejects.toMatchObject({ reason: "not-found" });
    } finally {
      store.close();
    }
  });
});
