import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import {
  AppLogWritePort,
  AbsolutePath,
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  IsoDateTimeStringSchema,
  normalizeExternalInstructionsSettings,
  ProviderAuthStatusStatePort,
  RuntimeWorkspaceStatePort,
  SandboxPolicySource,
  SecretStoreMutationPort,
  StateCommandPostCommitNotificationPort,
  StateContractError,
  SecretStorePortError,
} from "@svvy/core";
import type {
  AppLogEntryId,
  CommandId,
  AgentProfileId,
  CreateRuntimeOrchestratorSurfaceStateInput,
  ExtensionId,
  ExtensionEnvName,
  ExtensionRegistryObservationResult,
  ExtensionSourceBuildObservation,
  ExternalInstructionsSettings,
  GeneratedPackageBuildId,
  ModelId,
  PositiveDurationMs,
  QueueItemId,
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  RuntimeOwnerId,
  ProviderId,
  SnippetId,
  StateCommandPostCommitNotificationInput,
  StateRevision,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkflowAgentSourceObservation,
  WorkspaceId,
  WorkspaceSessionId,
  WorkspacePaneId,
  WorkspaceTabId,
  SecretStoreMutationPortService,
} from "@svvy/core";
import {
  StateCommands,
  StateFacadeError,
  StateReadModels,
  createStateAppLogsFacade,
  createStateCommandsFacade,
  createStateFacade,
  layer,
  stateCommandsFromRouter,
  stateReadModelsFromRouter,
  StateReadModelRequestSchema,
  type StateReadModelResult,
} from "./state-facade";
import { StateLayerConfigSchema } from "./state-layer-config";
import { testPlatformLayer } from "./platform-test-support";
import { appLogStateFromStore, createAppLogStore } from "./app-log-store";
import { runTestEffect } from "./effect.test-support";
import { buildStructuredCommandInspector } from "./structured-session-selectors";
import { createStructuredSessionStateStore } from "./structured-session-state";
import { createWorkspaceStateRouter } from "./workspace-state-router";

const iso = (value: string) => value as typeof IsoDateTimeStringSchema.Type;
const noop = () => {};
const rootWorkspaceId = "workspace_state_root" as WorkspaceId;
const openaiProviderId = "openai" as ProviderId;
const anthropicProviderId = "anthropic" as ProviderId;
const defaultArtifactDirectory = () => join(homedir(), ".config", "svvy", "artifacts");
const stateLayerConfig = () =>
  Schema.decodeUnknownSync(StateLayerConfigSchema)({
    databasePath: ":memory:",
    artifactRoot: "/tmp/svvy-state-facade-root-artifacts",
    busyTimeoutMs: 1_000,
  });
const testDigest = {
  sha256Hex: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
};

function orchestratorStateInput(
  workspaceId: WorkspaceId,
  title: string,
): CreateRuntimeOrchestratorSurfaceStateInput {
  return {
    workspaceId,
    title,
    profileId: "default-orchestrator" as AgentProfileId,
    provider: "zai" as ProviderId,
    model: "glm-5-turbo" as ModelId,
    reasoningEffort: "medium",
    loadedExtensionIds: ["extension-loading" as ExtensionId],
    availableExtensionIds: [],
  };
}
const extensionRegistryObservation = (
  extensionIds: readonly ExtensionId[],
  envDeclarations: ExtensionRegistryObservationResult["observations"][number]["envDeclarations"] = [],
  cliDeclarationsByExtension: Readonly<
    Record<string, ExtensionRegistryObservationResult["observations"][number]["cliDeclarations"]>
  > = {},
  envDeclarationsByExtension: Readonly<
    Record<string, ExtensionRegistryObservationResult["observations"][number]["envDeclarations"]>
  > = {},
): ExtensionRegistryObservationResult => ({
  aggregateFingerprint: `sha256:${extensionIds.join("-")}`,
  observations: extensionIds.map((extensionId, canonicalOrder) => ({
    extensionId,
    category: "builtin",
    interfaceKind: "instructions",
    svvyxImplementation: null,
    usagePolicy: {
      canonicalOrder,
      baselineUsage: {
        orchestrator: "available",
        handler: "available",
        "workflow-task": "available",
      },
      networkAccess: "not-required",
      configurable: true,
      fixedReason: null,
    },
    title: extensionId,
    description: `${extensionId} extension`,
    customized: false,
    buildRequirement: "not-required",
    materializationPlan: null,
    capabilities: {
      resettable: true,
      deletable: false,
      typescriptApiEnabled: false,
      materializationRequired: false,
    },
    contributors: [],
    tooling: [],
    cliDeclarations: cliDeclarationsByExtension[extensionId] ?? [],
    envDeclarations:
      envDeclarationsByExtension[extensionId] ?? (extensionIds.length === 1 ? envDeclarations : []),
    dependencyDeclarations: [],
    sourceFingerprint: `sha256:${createHash("sha256").update(extensionId).digest("hex")}`,
    diagnostics: [],
  })),
  diagnostics: [],
});
const unavailableSecretStoreMutation = SecretStoreMutationPort.of({
  writeSecretValue: () => Effect.die("unexpected secret-store write"),
  removeSecretValue: () => Effect.die("unexpected secret-store removal"),
});
const testStateDependencies = () =>
  Layer.merge(
    testPlatformLayer(),
    Layer.succeed(SecretStoreMutationPort, unavailableSecretStoreMutation),
  );
const stateLayer = () =>
  layer({ config: stateLayerConfig(), digest: testDigest }).pipe(
    Layer.provide(testStateDependencies()),
  );
const stateLayerWithNotifications = (published: StateCommandPostCommitNotificationInput[] = []) =>
  Layer.merge(
    stateLayer(),
    Layer.succeed(
      StateCommandPostCommitNotificationPort,
      StateCommandPostCommitNotificationPort.of({
        notifyCommittedStateCommand: (input) =>
          Effect.sync(() => {
            published.push(input);
            return {
              receipt: input.receipt,
              acceptedDescriptorCount: input.descriptors.length,
              rebaselineRequired: false,
            };
          }),
      }),
    ),
  );

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("State app-log facade slice", () => {
  it("adapts app-bootstrap app logs and the write port over one state-owned store", async () => {
    const appLogs = createStateAppLogsFacade({
      digest: testDigest,
      now: () => "2026-06-21T12:00:00.000Z",
    });
    try {
      const entries: string[] = [];
      const unsubscribe = appLogs.subscribe((updated) => {
        entries.push(...updated.map((entry) => entry.message));
      });

      appLogs.append({
        level: "info",
        source: "app.lifecycle",
        message: "AUTH_TOKEN=secret-value-here was ignored",
      });
      expect(typeof appLogs.writePort.append).toBe("function");
      appLogs.append({
        level: "warn",
        source: "workspace",
        message: "Bearer abcdefghijklmnop was ignored",
      });

      expect(entries).toEqual([
        "AUTH_TOKEN=[REDACTED] was ignored",
        "Bearer [REDACTED] was ignored",
      ]);
      expect(appLogs.query().entries.map((entry) => entry.message)).toEqual(entries);
      expect(appLogs.summary()).toMatchObject({
        latestSeq: 2,
        unread: { total: 2, info: 1, warn: 1 },
      });
      unsubscribe();
    } finally {
      appLogs.close();
    }
  });

  it("reads app-log read models through the final StateFacade surface", async () => {
    const managedRuntime = ManagedRuntime.make(stateLayer());
    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const sandboxPolicySource = yield* SandboxPolicySource;
          expect(sandboxPolicySource).toHaveProperty("snapshot");

          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            workspaceId: "workspace_state_facade_read" as WorkspaceId,
            level: "warn",
            source: "app.lifecycle",
            message: "AUTH_TOKEN=secret-value-here was ignored",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
        }),
      );

      const state = createStateFacade(managedRuntime);
      const logs = await state.readModels.fetch({
        kind: "appLogs",
        workspaceId: "workspace_state_facade_read" as WorkspaceId,
        query: { limit: 10 },
      });
      const summary = await state.readModels.fetch({
        kind: "appLogSummary",
        workspaceId: "workspace_state_facade_read" as WorkspaceId,
      });

      expect(logs.kind).toBe("appLogs");
      if (logs.kind !== "appLogs") throw new Error("Expected appLogs read model.");
      expect(logs.value.entries).toHaveLength(1);
      expect(logs.value.entries[0]?.message).toBe("AUTH_TOKEN=[REDACTED] was ignored");
      expect(summary).toEqual({
        kind: "appLogSummary",
        value: {
          latestSeq: 1,
          seenSeq: 0,
          unread: { total: 1, debug: 0, info: 0, warn: 1, error: 0 },
          totals: { total: 1, debug: 0, info: 0, warn: 1, error: 0 },
        },
      });
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("projects sandbox policy roots from state layer config", async () => {
    const managedRuntime = ManagedRuntime.make(
      layer({
        config: Schema.decodeUnknownSync(StateLayerConfigSchema)({
          databasePath: ":memory:",
          artifactRoot: "/tmp/svvy-state-facade-sandbox-artifacts",
          busyTimeoutMs: 1_000,
          sandboxPolicy: {
            generatedOutputRoots: ["/tmp/svvy-state-facade-generated/core-type-contract"],
            temporaryRoots: ["/tmp/svvy-state-facade-tmp"],
          },
        }),
        digest: testDigest,
      }).pipe(Layer.provide(testStateDependencies())),
    );
    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const sandboxPolicySource = yield* SandboxPolicySource;
          const snapshot = yield* sandboxPolicySource.snapshot({
            scope: { kind: "workspace", workspaceId: rootWorkspaceId },
            commandId: "cmd_state_facade_sandbox_policy" as CommandId,
            launchKind: "direct_shell",
            cwd: "/tmp" as typeof AbsolutePath.Type,
          });

          expect(snapshot.filesystemPolicy.entries).toContainEqual({
            access: "read",
            path: "/tmp/svvy-state-facade-generated/core-type-contract" as typeof AbsolutePath.Type,
            recursive: true,
            source: "generated-output",
          });
          expect(snapshot.filesystemPolicy.entries).toContainEqual({
            access: "write",
            path: "/tmp/svvy-state-facade-tmp" as typeof AbsolutePath.Type,
            recursive: true,
            source: "temporary",
          });
        }),
      );
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("runs app-log read-state commands through the final command facade", async () => {
    const workspaceId = "workspace_state_facade_command" as WorkspaceId;
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications(published));

    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            workspaceId,
            level: "info",
            source: "workspace",
            message: "first",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
          yield* appLogWritePort.append({
            workspaceId,
            level: "error",
            source: "workspace",
            message: "second",
            occurredAt: iso("2026-06-21T12:01:00.000Z"),
          });
        }),
      );

      const commands = createStateCommandsFacade(managedRuntime);

      const first = await commands.appLogs.markRead({
        workspaceId,
        entryIds: ["app-log-1" as AppLogEntryId],
        readAt: iso("2026-06-21T12:02:00.000Z"),
        clientSubmission: {
          clientRequestId: "mark-read-1" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const duplicate = await commands.appLogs.markRead({
        workspaceId,
        entryIds: ["app-log-1" as AppLogEntryId],
        readAt: iso("2026-06-21T12:02:00.000Z"),
        clientSubmission: {
          clientRequestId: "mark-read-1" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const state = createStateFacade(managedRuntime);
      const summary = await state.readModels.fetch({ kind: "appLogSummary", workspaceId });

      expect(first.receipt).toMatchObject({
        clientRequestId: "mark-read-1",
        outcome: "applied",
        committedAt: "2026-06-21T12:02:00.000Z",
        stateRevision: 2,
      });
      expect(duplicate.receipt).toMatchObject({
        clientRequestId: "mark-read-1",
        outcome: "duplicate",
      });
      expect(summary.kind).toBe("appLogSummary");
      if (summary.kind !== "appLogSummary") throw new Error("Expected appLogSummary read model.");
      expect(summary.value.seenSeq).toBe(1);
      expect(summary.value.unread).toEqual({ total: 1, debug: 0, info: 0, warn: 0, error: 1 });
      expect(published).toEqual([
        {
          operation: "stateCommands.appLogs.markRead",
          receipt: first.receipt,
          descriptors: [{ scope: "workspace", workspaceId, invalidation: { model: "appLogs" } }],
          clientSubmission: {
            clientRequestId: "mark-read-1" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        },
      ]);
      commands.close();
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("publishes app-scope app-log invalidations for app-global read-state commands", async () => {
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications(published));

    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            level: "warn",
            source: "app.lifecycle",
            message: "global warning",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
        }),
      );

      const commands = createStateCommandsFacade(managedRuntime);
      const result = await commands.appLogs.clearWorkspaceUnread({
        readAt: iso("2026-06-21T12:02:00.000Z"),
        clientSubmission: {
          clientRequestId: "clear-global-unread" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const state = createStateFacade(managedRuntime);
      const refetched = await state.readModels.refetchInvalidation({
        descriptor: { scope: "app", invalidation: { model: "appLogs" } },
      });

      expect(result.receipt).toMatchObject({
        clientRequestId: "clear-global-unread",
        outcome: "applied",
        committedAt: "2026-06-21T12:02:00.000Z",
        stateRevision: 1,
      });
      expect(published).toEqual([
        {
          operation: "stateCommands.appLogs.clearWorkspaceUnread",
          receipt: result.receipt,
          descriptors: [{ scope: "app", invalidation: { model: "appLogs" } }],
          clientSubmission: {
            clientRequestId: "clear-global-unread" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        },
      ]);
      expect(refetched.map((readModel) => readModel.kind)).toEqual(["appLogs", "appLogSummary"]);
      commands.close();
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("routes second-half StateCommands groups with idempotent receipts and descriptors", async () => {
    const workspaceId = rootWorkspaceId;
    const secondWorkspaceId = "workspace_state_second" as WorkspaceId;
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications(published));

    try {
      const commands = createStateCommandsFacade(managedRuntime);
      const tab = {
        workspaceTabId: "workspace-tab-command-facade" as WorkspaceTabId,
        workspaceId,
        cwd: "/tmp/svvy-state-command-facade" as typeof AbsolutePath.Type,
        workspaceLabel: "Command facade",
        kind: "user" as const,
        openedAt: iso("2026-06-21T12:00:00.000Z"),
        activeLayoutId: "A" as const,
      };
      const secondTab = {
        workspaceTabId: "workspace-tab-command-facade-second" as WorkspaceTabId,
        workspaceId: secondWorkspaceId,
        cwd: "/tmp/svvy-state-command-facade-second" as typeof AbsolutePath.Type,
        workspaceLabel: "Command facade second",
        kind: "user" as const,
        openedAt: iso("2026-06-21T12:00:00.000Z"),
        activeLayoutId: "A" as const,
      };
      const cases = [
        {
          operation: "stateCommands.workspaceChrome.setTabs",
          clientRequestId: "workspace-chrome-command",
          run: () =>
            commands.workspaceChrome.setTabs({
              activeWorkspaceTabId: tab.workspaceTabId,
              tabs: [tab, secondTab],
              knownWorkspaces: [tab, secondTab],
              clientSubmission: {
                clientRequestId: "workspace-chrome-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [{ scope: "app", invalidation: { model: "workspaceChrome" } }],
        },
        {
          operation: "stateCommands.workspaceChrome.selectTab",
          clientRequestId: "workspace-chrome-select-command",
          run: () =>
            commands.workspaceChrome.selectTab({
              workspaceTabId: secondTab.workspaceTabId,
              clientSubmission: {
                clientRequestId: "workspace-chrome-select-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [{ scope: "app", invalidation: { model: "workspaceChrome" } }],
        },
        {
          operation: "stateCommands.workspaceChrome.selectLayoutSlot",
          clientRequestId: "workspace-chrome-layout-select-command",
          run: () =>
            commands.workspaceChrome.selectLayoutSlot({
              workspaceTabId: tab.workspaceTabId,
              layoutId: "B",
              clientSubmission: {
                clientRequestId: "workspace-chrome-layout-select-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [{ scope: "app", invalidation: { model: "workspaceChrome" } }],
        },
        {
          operation: "stateCommands.workspaceLayout.saveSlot",
          clientRequestId: "workspace-layout-command",
          run: () =>
            commands.workspaceLayout.saveSlot({
              workspaceId,
              layoutId: "A",
              dockviewJson: { dockview: true },
              focusedPaneId: "pane-command-facade" as WorkspacePaneId,
              panes: [
                {
                  paneId: "pane-command-facade" as WorkspacePaneId,
                  target: {
                    surface: "agents",
                    targetAgentProfileId: "profile-default" as AgentProfileId,
                  },
                  localState: { scroll: null, timelineDensity: "comfortable" },
                  fallbackChrome: null,
                  placement: null,
                  restore: { kind: "ready" },
                },
              ],
              compactSurfaces: [],
              clientSubmission: {
                clientRequestId: "workspace-layout-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "workspaceLayout", ids: ["A"] },
            },
          ],
        },
        {
          operation: "stateCommands.extensionEnv.setOverride",
          clientRequestId: "extension-env-command",
          run: () =>
            commands.extensionEnv.setOverride({
              extensionId: "shell" as ExtensionId,
              envName: "SVVY_TEST_ENV" as ExtensionEnvName,
              value: "enabled",
              clientSubmission: {
                clientRequestId: "extension-env-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [{ scope: "app", invalidation: { model: "extensions", ids: ["shell"] } }],
        },
        {
          operation: "stateCommands.agentProfiles.updateOrchestrator",
          clientRequestId: "agent-profile-command",
          run: () =>
            commands.agentProfiles.updateOrchestrator({
              profile: {
                profileId: "agent-profile-command" as AgentProfileId,
                name: "Command profile",
                providerId: openaiProviderId,
                modelId: "gpt-5" as ModelId,
                extensionUsage: { ["shell" as ExtensionId]: "loaded" },
                followComposer: true,
              },
              clientSubmission: {
                clientRequestId: "agent-profile-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [
            {
              scope: "app",
              invalidation: { model: "agents", ids: ["agent-profile-command"] },
            },
          ],
        },
        {
          operation: "stateCommands.snippets.createManaged",
          clientRequestId: "snippet-command",
          run: () =>
            commands.snippets.createManaged({
              workspaceId,
              title: "Reusable prompt",
              body: "Summarize this file.",
              metadata: { description: "Summarize a file", argumentHint: "path" },
              enabled: true,
              clientSubmission: {
                clientRequestId: "snippet-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [
            {
              scope: "workspace",
              workspaceId,
              invalidation: { model: "snippets", ids: ["$createdSnippetId"] },
            },
          ],
        },
      ] as const;

      for (const [index, entry] of cases.entries()) {
        const first = await entry.run();
        const duplicate = await entry.run();
        expect(first.receipt).toMatchObject({
          clientRequestId: entry.clientRequestId,
          outcome: "applied",
        });
        expect(duplicate.receipt).toMatchObject({
          clientRequestId: entry.clientRequestId,
          outcome: "duplicate",
        });
        expect(published).toHaveLength(index + 1);
        const expectedDescriptors = entry.descriptors.map((descriptor) =>
          descriptor.invalidation.model === "snippets" && "snippetId" in first
            ? {
                ...descriptor,
                invalidation: {
                  ...descriptor.invalidation,
                  ids: [first.snippetId],
                },
              }
            : descriptor,
        );
        expect(published[index]).toMatchObject({
          operation: entry.operation,
          descriptors: expectedDescriptors,
          clientSubmission: {
            clientRequestId: entry.clientRequestId,
            source: "test",
          },
        });
      }

      await expect(
        commands.workspaceChrome.selectTab({
          workspaceTabId: "workspace-tab-missing" as WorkspaceTabId,
        }),
      ).rejects.toBeInstanceOf(StateFacadeError);

      commands.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("does not resolve state command facade calls before post-commit publication accepts descriptors", async () => {
    let acceptPublication!: () => void;
    const publicationAccepted = new Promise<void>((resolve) => {
      acceptPublication = resolve;
    });
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(
      Layer.merge(
        stateLayer(),
        Layer.succeed(
          StateCommandPostCommitNotificationPort,
          StateCommandPostCommitNotificationPort.of({
            notifyCommittedStateCommand: (input) =>
              Effect.promise(async () => {
                published.push(input);
                await publicationAccepted;
                return {
                  receipt: input.receipt,
                  acceptedDescriptorCount: input.descriptors.length,
                  rebaselineRequired: false,
                };
              }),
          }),
        ),
      ),
    );

    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            level: "info",
            source: "app.lifecycle",
            message: "pending publication",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
        }),
      );

      const commands = createStateCommandsFacade(managedRuntime);
      let resolved = false;
      const command = commands.appLogs.clearWorkspaceUnread({
        readAt: iso("2026-06-21T12:02:00.000Z"),
        clientSubmission: {
          clientRequestId: "clear-global-unread-delayed" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      void command.then(() => {
        resolved = true;
      });

      await waitFor(() => published.length === 1);
      expect(resolved).toBe(false);

      acceptPublication();
      const result = await command;

      expect(resolved).toBe(true);
      expect(result.receipt).toMatchObject({
        clientRequestId: "clear-global-unread-delayed",
        outcome: "applied",
      });
      commands.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("reads app preferences and settings read models through the final StateFacade surface", async () => {
    const managedRuntime = ManagedRuntime.make(stateLayer());

    try {
      const state = createStateFacade(managedRuntime);
      const appPreferences = await state.readModels.fetch({ kind: "appPreferences" });
      const settings = await state.readModels.fetch({ kind: "settings" });
      const baseline = await state.readModels.rebaseline({ reason: "renderer-startup" });

      expect(appPreferences.kind).toBe("appPreferences");
      if (appPreferences.kind !== "appPreferences") {
        throw new Error("Expected appPreferences read model.");
      }
      expect(appPreferences.value).toMatchObject({
        appearance: "system",
        externalEditor: null,
        artifactDirectory: defaultArtifactDirectory(),
        approvalMode: "auto-review",
        networkAccess: true,
        externalInstructions: DEFAULT_EXTERNAL_INSTRUCTIONS,
        ambientResources: {},
        updatedAt: "1970-01-01T00:00:00.000Z",
        revision: 0,
      });
      expect(settings).toEqual({
        kind: "settings",
        value: {
          preferences: appPreferences.value,
          requestInput: {
            mode: "nonblocking",
            blockingTimeout: {
              enabled: true,
              durationMs: 300000 as PositiveDurationMs,
            },
          },
        },
      });
      expect(baseline.app.map((readModel) => readModel.kind)).toEqual([
        "appLogSummary",
        "appPreferences",
        "settings",
        "providerAuth",
        "agents",
        "extensions",
        "workflowsGenerated",
        "workspaceChrome",
      ]);
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("updates app preferences through the final command facade", async () => {
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications(published));
    const externalInstructions: ExternalInstructionsSettings = {
      globalRoots: [
        {
          id: "custom-docs",
          kind: "custom",
          label: "Custom docs",
          path: "/tmp/custom-docs",
          enabled: true,
        },
      ],
      globalControls: {
        "custom-docs/AGENTS.md": {
          enabled: true,
          actors: ["orchestrator", "handler"],
        },
      },
      workspaceControls: {
        workspace_state_root: {
          "workspace/CLAUDE.md": {
            enabled: false,
            actors: ["workflow-task"],
          },
        },
      },
    };

    try {
      const commands = createStateCommandsFacade(managedRuntime);
      const first = await commands.appPreferences.update({
        patch: {
          appearance: "dark",
          externalEditor: "code",
          artifactDirectory: "/tmp/svvy-custom-artifacts" as typeof AbsolutePath.Type,
          approvalMode: "user",
          networkAccess: false,
          externalInstructions,
          ambientResources: { skills: true, commands: false },
        },
        clientSubmission: {
          clientRequestId: "settings-save-01" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const duplicate = await commands.appPreferences.update({
        patch: { approvalMode: "full-access" },
        clientSubmission: {
          clientRequestId: "settings-save-01" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const state = createStateFacade(managedRuntime);
      const appPreferences = await state.readModels.fetch({ kind: "appPreferences" });
      const settingsRefetch = await state.readModels.refetchInvalidation({
        descriptor: { scope: "app", invalidation: { model: "settings" } },
      });

      expect(first.receipt).toMatchObject({
        clientRequestId: "settings-save-01",
        outcome: "applied",
        committedAt: "1970-01-01T00:00:00.000Z",
        stateRevision: 1,
      });
      expect(duplicate.receipt).toMatchObject({
        clientRequestId: "settings-save-01",
        outcome: "duplicate",
      });
      expect(appPreferences.kind).toBe("appPreferences");
      if (appPreferences.kind !== "appPreferences") {
        throw new Error("Expected appPreferences read model.");
      }
      expect(appPreferences.value).toMatchObject({
        appearance: "dark",
        externalEditor: "code",
        artifactDirectory: "/tmp/svvy-custom-artifacts",
        approvalMode: "user",
        networkAccess: false,
        externalInstructions: normalizeExternalInstructionsSettings(externalInstructions),
        ambientResources: { skills: true, commands: false },
        updatedAt: "1970-01-01T00:00:00.000Z",
        revision: 1,
      });
      expect(settingsRefetch).toEqual([
        {
          kind: "settings",
          value: {
            preferences: appPreferences.value,
            requestInput: {
              mode: "nonblocking",
              blockingTimeout: {
                enabled: true,
                durationMs: 300000 as PositiveDurationMs,
              },
            },
          },
        },
      ]);
      expect(published).toEqual([
        {
          operation: "stateCommands.appPreferences.update",
          receipt: first.receipt,
          descriptors: [
            { scope: "app", invalidation: { model: "appPreferences" } },
            { scope: "app", invalidation: { model: "settings" } },
          ],
          clientSubmission: {
            clientRequestId: "settings-save-01" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        },
      ]);
      commands.close();
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("reads provider auth statuses through the final StateFacade surface", async () => {
    const managedRuntime = ManagedRuntime.make(stateLayer());

    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const providerAuth = yield* ProviderAuthStatusStatePort;
          yield* providerAuth.recordProviderStatus({
            status: {
              providerId: openaiProviderId,
              health: "usable",
              redactedAccountLabel: "acct-openai",
              refreshedAt: iso("2026-06-21T12:00:00.000Z"),
            },
            observedAt: iso("2026-06-21T12:00:00.000Z"),
            source: "startup_scan",
          });
          yield* providerAuth.recordProviderStatus({
            status: {
              providerId: anthropicProviderId,
              health: "expired",
              redactedAccountLabel: "acct-anthropic",
              expiresAt: iso("2026-06-21T11:00:00.000Z"),
              issue: "credential expired",
            },
            observedAt: iso("2026-06-21T12:01:00.000Z"),
            source: "provider_refresh",
          });
        }),
      );

      const state = createStateFacade(managedRuntime);
      const providerAuth = await state.readModels.fetch({ kind: "providerAuth" });
      const refetched = await state.readModels.refetchInvalidation({
        descriptor: { scope: "app", invalidation: { model: "providerAuth" } },
      });
      const baseline = await state.readModels.rebaseline({ reason: "renderer-startup" });

      expect(providerAuth.kind).toBe("providerAuth");
      if (providerAuth.kind !== "providerAuth") {
        throw new Error("Expected providerAuth read model.");
      }
      expect(providerAuth.value.providers.map((provider) => provider.providerId)).toEqual([
        anthropicProviderId,
        openaiProviderId,
      ]);
      expect(providerAuth.value.usableModelProviders).toEqual([openaiProviderId]);
      expect(refetched).toEqual([{ kind: "providerAuth", value: providerAuth.value }]);
      expect(baseline.app.map((readModel) => readModel.kind)).toContain("providerAuth");
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("records provider auth status through the final command facade", async () => {
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications(published));

    try {
      const commands = createStateCommandsFacade(managedRuntime);
      const first = await commands.providerAuth.recordStatus({
        status: {
          providerId: openaiProviderId,
          health: "usable",
          redactedAccountLabel: "acct-openai",
          refreshedAt: iso("2026-06-21T12:00:00.000Z"),
        },
        observedAt: iso("2026-06-21T12:00:00.000Z"),
        source: "startup_scan",
        clientSubmission: {
          clientRequestId: "provider-status-01" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const duplicate = await commands.providerAuth.recordStatus({
        status: {
          providerId: anthropicProviderId,
          health: "missing",
          issue: "not configured",
        },
        observedAt: iso("2026-06-21T12:01:00.000Z"),
        source: "runtime_retry",
        clientSubmission: {
          clientRequestId: "provider-status-01" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const workspaceId = "workspace_provider_status_01" as WorkspaceId;
      const workspaceStatus = await commands.providerAuth.recordStatus({
        status: {
          providerId: openaiProviderId,
          workspaceId,
          health: "expired",
          redactedAccountLabel: "acct-openai-workspace",
          expiresAt: iso("2026-06-21T12:30:00.000Z"),
          issue: "workspace credential expired",
        },
        observedAt: iso("2026-06-21T12:02:00.000Z"),
        source: "provider_refresh",
        clientSubmission: {
          clientRequestId: "provider-status-workspace-01" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      });
      const state = createStateFacade(managedRuntime);
      const providerAuth = await state.readModels.fetch({ kind: "providerAuth" });
      const workspaceProviderAuth = await state.readModels.fetch({
        kind: "providerAuth",
        workspaceId,
      });
      const refetched = await state.readModels.refetchInvalidation({
        descriptor: {
          scope: "app",
          invalidation: { model: "providerAuth", ids: [openaiProviderId] },
        },
      });
      const baseline = await state.readModels.rebaseline({ reason: "manual-refresh" });

      expect(first.receipt).toMatchObject({
        clientRequestId: "provider-status-01",
        outcome: "applied",
        committedAt: "2026-06-21T12:00:00.000Z",
        stateRevision: 1,
      });
      expect(workspaceStatus.receipt).toMatchObject({
        clientRequestId: "provider-status-workspace-01",
        outcome: "applied",
        committedAt: "2026-06-21T12:02:00.000Z",
        stateRevision: 2,
      });
      expect(duplicate.receipt).toMatchObject({
        clientRequestId: "provider-status-01",
        outcome: "duplicate",
      });
      expect(providerAuth.kind).toBe("providerAuth");
      if (providerAuth.kind !== "providerAuth") {
        throw new Error("Expected providerAuth read model.");
      }
      expect(providerAuth.value.providers.map((provider) => provider.providerId)).toEqual([
        openaiProviderId,
      ]);
      expect(workspaceProviderAuth.kind).toBe("providerAuth");
      if (workspaceProviderAuth.kind !== "providerAuth") {
        throw new Error("Expected workspace providerAuth read model.");
      }
      expect(workspaceProviderAuth.value.providers).toEqual([
        {
          providerId: openaiProviderId,
          workspaceId,
          health: "expired",
          redactedAccountLabel: "acct-openai-workspace",
          expiresAt: iso("2026-06-21T12:30:00.000Z"),
          issue: "workspace credential expired",
        },
      ]);
      expect(workspaceProviderAuth.value.usableModelProviders).toEqual([]);
      expect(refetched).toEqual([{ kind: "providerAuth", value: providerAuth.value }]);
      expect(baseline.revision).toBe(2 as StateRevision);
      expect(published).toEqual([
        {
          operation: "stateCommands.providerAuth.recordStatus",
          receipt: first.receipt,
          descriptors: [
            {
              scope: "app",
              invalidation: { model: "providerAuth", ids: [openaiProviderId] },
            },
          ],
          clientSubmission: {
            clientRequestId: "provider-status-01" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        },
        {
          operation: "stateCommands.providerAuth.recordStatus",
          receipt: workspaceStatus.receipt,
          descriptors: [
            {
              scope: "app",
              invalidation: { model: "providerAuth", ids: [openaiProviderId] },
            },
          ],
          clientSubmission: {
            clientRequestId: "provider-status-workspace-01" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        },
      ]);
      commands.close();
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("maps post-commit notification failures to the committed-receipt facade error", async () => {
    const workspaceId = "workspace_state_facade_post_commit_failure" as WorkspaceId;
    const managedRuntime = ManagedRuntime.make(
      Layer.merge(
        stateLayer(),
        Layer.succeed(
          StateCommandPostCommitNotificationPort,
          StateCommandPostCommitNotificationPort.of({
            notifyCommittedStateCommand: (input) =>
              Effect.fail({
                type: "state-command-post-commit-notification-error",
                operation: input.operation,
                reason: "publication-failed",
                receipt: input.receipt,
                message: "notification bus unavailable",
                affectedReadModels: input.descriptors,
              }),
          }),
        ),
      ),
    );

    try {
      await managedRuntime.runPromise(
        Effect.gen(function* () {
          const appLogWritePort = yield* AppLogWritePort;
          yield* appLogWritePort.append({
            workspaceId,
            level: "info",
            source: "workspace",
            message: "first",
            occurredAt: iso("2026-06-21T12:00:00.000Z"),
          });
        }),
      );

      const commands = createStateCommandsFacade(managedRuntime);
      await commands.appLogs
        .clearWorkspaceUnread({
          workspaceId,
          readAt: iso("2026-06-21T12:02:00.000Z"),
          clientSubmission: {
            clientRequestId: "clear-unread-fail-post-commit" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        })
        .then(
          () => {
            throw new Error("Expected post-commit notification failure.");
          },
          (error: unknown) => {
            expect(error).toBeInstanceOf(StateFacadeError);
            const contract = (error as StateFacadeError).contract;
            expect(contract.reason).toBe("post-commit-notification-failed");
            if (contract.reason === "post-commit-notification-failed") {
              expect(contract.receipt).toMatchObject({
                clientRequestId: "clear-unread-fail-post-commit",
                outcome: "applied",
                committedAt: "2026-06-21T12:02:00.000Z",
              });
              expect(contract.notificationError).toMatchObject({
                type: "state-command-post-commit-notification-error",
                operation: "stateCommands.appLogs.clearWorkspaceUnread",
                reason: "publication-failed",
                message: "notification bus unavailable",
              });
              expect(contract.message).toContain("notification bus unavailable");
            }
          },
        );
      commands.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("provides structured-session ports from the private root layer composition", async () => {
    const managedRuntime = ManagedRuntime.make(stateLayer());

    try {
      const acquired = await managedRuntime.runPromise(
        Effect.gen(function* () {
          const workspaces = yield* RuntimeWorkspaceStatePort;
          return yield* workspaces.acquireDefaultWorkspace({
            owner: {
              ownerId: "runtime_owner_state_facade_root" as RuntimeOwnerId,
              kind: "test",
            },
            openReason: "test",
          });
        }),
      );

      expect(acquired.value.workspaceId).toBe(rootWorkspaceId);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("maps invalid app-log command input to a typed StateFacadeError", async () => {
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications());
    try {
      const commands = createStateCommandsFacade(managedRuntime);
      await expect(
        commands.appLogs.clearWorkspaceUnread({
          readAt: "2026-06-21T12:00:00.000Z",
          clientSubmission: { clientRequestId: 123 },
        } as never),
      ).rejects.toMatchObject({
        name: "StateFacadeError",
        type: "state-facade-error",
        reason: "typed-failure",
      });
      await commands.appLogs
        .clearWorkspaceUnread({
          readAt: "2026-06-21T12:00:00.000Z",
          clientSubmission: { clientRequestId: 123 },
        } as never)
        .catch((error: unknown) => {
          expect(error).toBeInstanceOf(StateFacadeError);
          expect((error as { error?: unknown }).error).toBeUndefined();
          const contract = (error as StateFacadeError).contract;
          expect(contract.reason).toBe("typed-failure");
          expect(contract).toMatchObject({
            reason: "typed-failure",
            error: { reason: "invalid-input" },
          });
          if (contract.reason === "typed-failure") {
            expect(contract.error).toBeInstanceOf(StateContractError);
          }
        });
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("rejects excess app-log command fields at the state facade boundary", async () => {
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications());
    try {
      const commands = createStateCommandsFacade(managedRuntime);
      await commands.appLogs
        .clearWorkspaceUnread({
          workspaceId: "workspace_state_facade_extra" as WorkspaceId,
          readAt: "2026-06-21T12:00:00.000Z",
          clientSubmission: { clientRequestId: "extra-command-field", source: "test" },
          previewOnly: "not a command contract field",
        } as never)
        .then(
          () => {
            throw new Error("Expected excess command field to fail.");
          },
          (error: unknown) => {
            expect(error).toBeInstanceOf(StateFacadeError);
            const contract = (error as StateFacadeError).contract;
            expect(contract.reason).toBe("typed-failure");
            if (contract.reason === "typed-failure") {
              expect(contract.error).toBeInstanceOf(StateContractError);
              expect(contract.error.reason).toBe("invalid-input");
            }
          },
        );
      commands.close();
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("interrupts the running Effect when a facade AbortSignal aborts after admission", async () => {
    const controller = new AbortController();
    let notifyStarted: () => void = noop;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let finalized = false;
    const blockingRead = Effect.sync(() => notifyStarted()).pipe(
      Effect.flatMap(() => Effect.never),
      Effect.ensuring(
        Effect.sync(() => {
          finalized = true;
        }),
      ),
    ) as Effect.Effect<StateReadModelResult, StateContractError>;
    const managedRuntime = ManagedRuntime.make(
      Layer.succeed(
        StateReadModels,
        StateReadModels.of({
          fetch: () => blockingRead,
          refetchInvalidation: () => Effect.die("unused refetchInvalidation"),
          rebaseline: () => Effect.die("unused rebaseline"),
        }),
      ),
    );

    try {
      const state = createStateFacade(managedRuntime);
      const promise = state.readModels.fetch(
        { kind: "appLogSummary", workspaceId: "workspace_abort" as WorkspaceId },
        { signal: controller.signal },
      );
      await started;
      controller.abort();

      await expect(promise).rejects.toMatchObject({
        name: "StateFacadeError",
        type: "state-facade-error",
        reason: "interrupted",
      });
      expect(finalized).toBe(true);
      state.close();
    } finally {
      await managedRuntime.dispose();
    }
  });
});

describe("State extension env secret commands", () => {
  it("owns versioned secret persistence, replay, replacement, removal, and cleanup recovery", async () => {
    const sentinel = "SVVY_SENTINEL_SECRET_DO_NOT_PERSIST";
    const extensionId = "secret-test" as ExtensionId;
    const envName = "API_TOKEN" as ExtensionEnvName;
    const store = createStructuredSessionStateStore({
      databasePath: ":memory:",
      digest: testDigest,
      now: () => "2026-07-12T10:00:00.000Z",
      workspace: {
        id: rootWorkspaceId,
        label: "Secret state",
        cwd: "/tmp/svvy-secret-state" as typeof AbsolutePath.Type,
        artifactDir: "/tmp/svvy-secret-state-artifacts" as typeof AbsolutePath.Type,
      },
    });
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-07-12T10:00:00.000Z",
    });
    const material = new Set<string>();
    const calls: string[] = [];
    let nextMaterial = 0;
    let failRemovalFor: string | null = null;
    let failNextWrite = false;
    const secretStoreMutation: SecretStoreMutationPortService = {
      writeSecretValue: (input) =>
        Effect.gen(function* () {
          if (failNextWrite) {
            failNextWrite = false;
            return yield* Effect.fail(
              new SecretStorePortError({
                operation: "test.write",
                reason: "persistence-failed",
                message: "Secret write failed.",
              }),
            );
          }
          const materialId = `material_${++nextMaterial}`;
          calls.push(`write:${materialId}`);
          if (input.replaces && !material.has(input.replaces.ref.materialId)) {
            throw new Error("replacement removed prior material before the new write");
          }
          material.add(materialId);
          return {
            ref: { ...input.target, materialId } as never,
            revisionFingerprint: `revision_${materialId}`,
          };
        }),
      removeSecretValue: (input) =>
        Effect.gen(function* () {
          calls.push(`remove:${input.ref.materialId}`);
          const persisted = store.listExtensionEnvSecrets();
          if (persisted.some((record) => record.ref.materialId === input.ref.materialId)) {
            return yield* Effect.die("host removal ran before the DB ref changed");
          }
          if (failRemovalFor === input.ref.materialId) {
            return yield* Effect.fail(
              new SecretStorePortError({
                operation: "test.remove",
                reason: "persistence-failed",
                message: "Secret cleanup failed.",
              }),
            );
          }
          material.delete(input.ref.materialId);
          return {
            ref: input.ref,
            removed: true,
            revisionFingerprint: input.expectedRevisionFingerprint ?? "unknown",
          };
        }),
    };
    const router = createWorkspaceStateRouter({ appGlobalStore: store, workspaceStores: [] });
    const commands = stateCommandsFromRouter({
      router,
      appLogs: appLogStateFromStore(appLogStore),
      secretStoreMutation,
    });
    const readModels = stateReadModelsFromRouter({
      router,
      appLogs: appLogStateFromStore(appLogStore),
    });
    const submission = (clientRequestId: string) => ({
      clientRequestId: clientRequestId as RuntimeClientRequestId,
      source: "test" as RuntimeClientSubmissionSource,
    });

    try {
      await expect(
        runTestEffect(
          commands.extensionEnv.setSecret({
            extensionId,
            envName,
            secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
            clientSubmission: submission("invalid-target"),
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      expect(calls).toEqual([]);

      store.reconcileExtensionEnvDeclarations({
        declarations: [
          { extensionId, envName, required: true, secret: true, description: "Test token" },
          {
            extensionId,
            envName: "PUBLIC_ENDPOINT",
            required: true,
            secret: false,
            description: "Not a secret",
          },
          {
            extensionId,
            envName: "FAIL_TOKEN",
            required: false,
            secret: true,
            description: "Failure probe",
          },
        ],
      });
      await expect(
        runTestEffect(
          commands.extensionEnv.setSecret({
            extensionId,
            envName: "PUBLIC_ENDPOINT" as ExtensionEnvName,
            secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
            clientSubmission: submission("non-secret-target"),
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      expect(calls).toEqual([]);
      failNextWrite = true;
      await expect(
        runTestEffect(
          commands.extensionEnv.setSecret({
            extensionId,
            envName: "FAIL_TOKEN" as ExtensionEnvName,
            secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
            clientSubmission: submission("failed-host-write"),
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      expect(store.listExtensionEnvSecrets()).toEqual([]);
      expect(
        store.readExtensionEnvSecretCommandState({
          operation: "set",
          clientRequestId: "failed-host-write",
          extensionId,
          envName: "FAIL_TOKEN",
        }).receipt,
      ).toBeNull();
      const first = await runTestEffect(
        commands.extensionEnv.setSecret({
          extensionId,
          envName,
          secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
          clientSubmission: submission("set-first"),
        }),
      );
      expect(first.value).toMatchObject({ configured: true, receipt: { outcome: "applied" } });
      const duplicate = await runTestEffect(
        commands.extensionEnv.setSecret({
          extensionId,
          envName,
          secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
          clientSubmission: submission("set-first"),
        }),
      );
      expect(duplicate.value.receipt.outcome).toBe("duplicate");
      expect(calls).toEqual(["write:material_1"]);
      await expect(
        runTestEffect(
          commands.extensionEnv.setSecret({
            extensionId,
            envName,
            secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
            expectedRevisionFingerprint: "stale-revision",
            clientSubmission: submission("stale-replacement"),
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      expect(calls).toEqual(["write:material_1"]);
      await expect(
        runTestEffect(
          commands.extensionEnv.removeSecret({
            extensionId,
            envName,
            clientSubmission: submission("set-first"),
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      expect(calls).toEqual(["write:material_1"]);

      failRemovalFor = "material_1";
      const replacement = await runTestEffect(
        commands.extensionEnv.setSecret({
          extensionId,
          envName,
          secretValue: Redacted.make(`${sentinel}_replacement`, {
            label: "extension-env-secret",
          }),
          expectedRevisionFingerprint: "revision_material_1",
          clientSubmission: submission("set-replacement"),
        }),
      );
      expect(replacement.value.configured).toBe(true);
      expect(calls).toEqual(["write:material_1", "write:material_2", "remove:material_1"]);
      expect(String(store.listExtensionEnvSecrets()[0]?.ref.materialId)).toBe("material_2");
      expect(store.listExtensionEnvSecretCleanupRecords()).toContainEqual(
        expect.objectContaining({
          reason: "replaced",
          revisionFingerprint: "revision_material_1",
        }),
      );
      failRemovalFor = null;

      store.reconcileExtensionRegistryObservation({
        observation: extensionRegistryObservation(
          [extensionId],
          [
            {
              name: envName,
              required: true,
              secret: true,
              description: "Test token",
              hasDefault: false,
            },
          ],
        ),
        observedAt: iso("2026-07-12T10:00:00.000Z"),
      });

      const projected = await runTestEffect(readModels.fetch({ kind: "extensions", extensionId }));
      expect(projected.kind).toBe("extensions");
      if (projected.kind !== "extensions") throw new Error("Expected extensions read model.");
      expect(
        projected.value.records
          .find((record) => record.extensionId === extensionId)
          ?.env?.find((entry) => entry.envName === envName),
      ).toMatchObject({ envName, configured: true, status: "configured" });
      const persistedAndProjected = JSON.stringify({
        declarations: store.listExtensionEnvDeclarations(),
        secrets: store.listExtensionEnvSecrets(),
        cleanup: store.listExtensionEnvSecretCleanupRecords(),
        projected,
        replacement,
      });
      expect(persistedAndProjected).not.toContain(sentinel);
      expect(JSON.stringify(projected)).not.toContain("material_2");
      expect(JSON.stringify(replacement)).not.toContain("material_");
      expect(JSON.stringify(replacement)).not.toContain('"ref"');

      const material2 = store.listExtensionEnvSecrets()[0]!;
      failRemovalFor = "material_2";
      const removed = await runTestEffect(
        commands.extensionEnv.removeSecret({
          extensionId,
          envName,
          expectedRevisionFingerprint: "revision_material_2",
          clientSubmission: submission("remove-current"),
        }),
      );
      expect(removed.value.configured).toBe(false);
      expect(store.listExtensionEnvSecrets()).toEqual([]);
      expect(calls.at(-1)).toBe("remove:material_2");
      expect(store.listExtensionEnvSecretCleanupRecords()).toContainEqual(
        expect.objectContaining({
          reason: "removed",
          revisionFingerprint: "revision_material_2",
        }),
      );
      failRemovalFor = null;
      await runTestEffect(
        secretStoreMutation.removeSecretValue({
          ref: material2.ref,
          expectedRevisionFingerprint: material2.revisionFingerprint,
        }),
      );
      store.completeExtensionEnvSecretCleanup(material2.ref);
      expect(
        store
          .listExtensionEnvSecretCleanupRecords()
          .some((record) => record.ref.materialId === material2.ref.materialId),
      ).toBe(false);
      const callsBeforeMissingRemove = calls.length;
      await runTestEffect(
        commands.extensionEnv.removeSecret({
          extensionId,
          envName,
          clientSubmission: submission("remove-missing"),
        }),
      );
      expect(calls).toHaveLength(callsBeforeMissingRemove);

      const orphanInput = {
        extensionId,
        envName,
        secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
        clientSubmission: submission("orphan-write"),
      };
      const originalCommit = store.commitExtensionEnvSecretSet.bind(store);
      store.commitExtensionEnvSecretSet = () => {
        throw new Error("injected DB commit failure");
      };
      failRemovalFor = "material_3";
      await expect(
        runTestEffect(commands.extensionEnv.setSecret(orphanInput)),
      ).rejects.toBeInstanceOf(StateContractError);
      store.commitExtensionEnvSecretSet = originalCommit;
      expect(store.listExtensionEnvSecretCleanupRecords()).toContainEqual(
        expect.objectContaining({
          reason: "orphaned",
          revisionFingerprint: "revision_material_3",
        }),
      );
      expect(JSON.stringify(store.listExtensionEnvSecretCleanupRecords())).not.toContain(sentinel);

      failRemovalFor = null;
      await runTestEffect(
        commands.extensionEnv.setSecret({
          extensionId,
          envName,
          secretValue: Redacted.make(sentinel, { label: "extension-env-secret" }),
          clientSubmission: submission("declaration-removal"),
        }),
      );
      store.reconcileExtensionEnvDeclarations({ declarations: [] });
      expect(store.listExtensionEnvSecrets()).toEqual([]);
      expect(store.listExtensionEnvSecretCleanupRecords()).toContainEqual(
        expect.objectContaining({ reason: "removed" }),
      );
    } finally {
      appLogStore.close();
      store.close();
    }
  });
});

describe("State read-model kind expansion", () => {
  it("requires explicit workspace routing for workspace inspector reads", () => {
    for (const request of [
      { kind: "promptHistory" },
      { kind: "handlerInspector", threadId: "thread-explicit-workspace" },
      {
        kind: "workflowTaskAttemptInspector",
        workflowTaskAttemptId: "workflow-task-explicit-workspace",
      },
      {
        kind: "artifactInspector",
        workspaceSessionId: "session-explicit-workspace",
        artifactId: "artifact-explicit-workspace",
      },
    ]) {
      expect(() => Schema.decodeUnknownSync(StateReadModelRequestSchema)(request)).toThrow();
    }
  });

  it("builds first-half renderer read models from structured-session router stores", async () => {
    let idSeq = 0;
    const store = createStructuredSessionStateStore({
      databasePath: ":memory:",
      digest: testDigest,
      idFactory: (prefix) => `${prefix}-facade-${++idSeq}`,
      now: (() => {
        let cursor = Date.parse("2026-06-21T12:00:00.000Z");
        return () => {
          const value = new Date(cursor).toISOString();
          cursor += 1_000;
          return value;
        };
      })(),
      workspace: {
        id: "workspace_state_facade_read_models" as WorkspaceId,
        label: "State facade read models",
        cwd: "/tmp/svvy-state-facade-read-models" as typeof AbsolutePath.Type,
        artifactDir: "/tmp/svvy-state-facade-read-models-artifacts" as typeof AbsolutePath.Type,
      },
    });
    try {
      store.updateOrchestratorProfile({
        profile: {
          profileId: "default-orchestrator" as AgentProfileId,
          name: "Default orchestrator",
          providerId: openaiProviderId,
          modelId: "gpt-5.4" as ModelId,
          reasoning: { effort: "high" },
          extensionUsage: {
            ["shell" as ExtensionId]: "loaded",
            ["git" as ExtensionId]: "unavailable",
          },
          extensionOrder: ["git", "shell"] as ExtensionId[],
          followComposer: true,
        },
      });
      const customOrchestratorProfile = store.updateOrchestratorProfile({
        profile: {
          profileId: "review-orchestrator" as AgentProfileId,
          name: "Review orchestrator",
          providerId: "anthropic" as ProviderId,
          modelId: "claude-opus-4-5" as ModelId,
          reasoning: { effort: "medium" },
          extensionUsage: {
            ["shell" as ExtensionId]: "available",
            ["smithers" as ExtensionId]: "unavailable",
          },
          extensionOrder: ["smithers", "shell"] as ExtensionId[],
          followComposer: false,
        },
      });
      const threadHandlerProfile = store.updateThreadHandlerProfile({
        profile: {
          profileId: "thread-handler" as AgentProfileId,
          name: "Thread handler",
          providerId: openaiProviderId,
          modelId: "gpt-5.4-mini" as ModelId,
          reasoning: { effort: "low" },
          extensionUsage: {
            ["shell" as ExtensionId]: "loaded",
            ["smithers" as ExtensionId]: "available",
          },
          extensionOrder: ["shell", "smithers"] as ExtensionId[],
        },
      });
      store.setAgentActorExtensionDefaults({
        actor: "orchestrator",
        extensionUsage: { shell: "loaded" },
        extensionOrder: ["shell", "git"],
      });
      const orchestratorExtensionDefaults = store.promoteProfileExtensionDefault({
        actor: "orchestrator",
        profileId: "default-orchestrator" as AgentProfileId,
        extensionId: "git" as ExtensionId,
        usage: "available",
      });
      const workflowTaskExtensionDefaults = store.setAgentActorExtensionDefaults({
        actor: "workflow-task",
        extensionUsage: { smithers: "loaded" },
        extensionOrder: ["smithers", "shell"],
      });
      const sparseDefaultOrchestratorProfile = store.setProfileExtensionUsage({
        actor: "orchestrator",
        profileId: "default-orchestrator" as AgentProfileId,
        extensionId: "shell" as ExtensionId,
        usage: "loaded",
      });
      const created = store.createOrchestratorSurface(
        orchestratorStateInput(
          "workspace_state_facade_read_models" as WorkspaceId,
          "Expanded read models",
        ),
      );
      store.upsertPiSession({
        ...store.getSessionState(created.workspaceSessionId).pi,
        parentSessionId: "session_state_facade_parent",
        orchestratorAgentProfileId: "default-orchestrator" as AgentProfileId,
        orchestratorAgentProfileJson: JSON.stringify({
          id: "default-orchestrator",
          name: "Default orchestrator",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "high",
          updateFromComposer: true,
        }),
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
      });
      const promptHistoryTarget = {
        workspaceSessionId: created.workspaceSessionId,
        surface: "orchestrator" as const,
        surfacePiSessionId: created.surfacePiSessionId,
      };
      const firstHistorySubmission = store.acceptSubmittedSurfaceMessage({
        target: promptHistoryTarget,
        idempotencyKey: "prompt-history-facade-1",
        promptHistoryText: "  Preserve this exact prompt.  ",
        messageJson: JSON.stringify({ text: "  Preserve this exact prompt.  " }),
      });
      const secondHistorySubmission = store.acceptSubmittedSurfaceMessage({
        target: promptHistoryTarget,
        idempotencyKey: "prompt-history-facade-2",
        promptHistoryText: "  Preserve this exact prompt.  ",
        messageJson: JSON.stringify({ text: "  Preserve this exact prompt.  " }),
      });
      store.cancelSurfaceMessage({ id: firstHistorySubmission.queuedMessage.id });
      store.cancelSurfaceMessage({ id: secondHistorySubmission.queuedMessage.id });
      store.setComposerDraft({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: created.surfacePiSessionId,
        text: "draft text",
        attachments: [
          {
            id: "attachment-1",
            kind: "file",
            name: "notes.md",
            path: "/tmp/notes.md",
          },
        ],
      });
      const turn = store.startTurn({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: created.surfacePiSessionId,
        requestSummary: "Run fixture command",
      });
      const command = store.createCommand({
        turnId: turn.id,
        surfacePiSessionId: created.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        title: "Run exec_command",
        summary: "Run fixture command",
        arguments: { cmd: "printf ok" },
        facts: { exitCode: 0 },
      });
      const artifact = store.recordArtifactMetadata({
        workspaceSessionId: created.workspaceSessionId,
        sourceCommandId: command.id,
        kind: "text",
        name: "read-model-preview.md",
        storedPath:
          "/tmp/svvy-state-facade-read-models-artifacts/" +
          `${created.workspaceSessionId}/read-model-preview.md`,
        mimeType: "text/markdown",
        byteSize: 42,
        sha256: "a".repeat(64),
        immutable: false,
        materializationStatus: "ready",
      });
      const transcriptUser = store.commitRuntimeTranscriptUserMessage({
        workspaceSessionId: created.workspaceSessionId as never,
        surfacePiSessionId: created.surfacePiSessionId as never,
        turnId: turn.id as never,
        queueItemId: "queue-state-facade-transcript" as never,
        message: { text: "Run fixture command" },
        submittedAt: "2026-06-21T12:00:00.000Z" as never,
        committedAt: "2026-06-21T12:00:01.000Z" as never,
        streamGenerationId: "stream-state-facade-transcript" as never,
        expectedCursor: null,
      });
      const handlerThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: "handler-surface-state-facade" as string,
        title: "Review docs",
        objective: "Inspect state facade read models.",
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        agentProfileJson: JSON.stringify({
          profileId: "thread-handler",
          name: "Thread handler",
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          reasoning: { effort: "low" },
        }),
        generatedAgentContextFingerprint: "handler-context-fingerprint",
      });
      store.upsertGeneratedAgentContextBinding({
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        ownerKind: "thread",
        ownerId: handlerThread.id,
        actorKind: "handler",
        systemPrompt: "Handle the delegated task.",
        svvyxGuidance: "Use svvyx carefully.",
        commandsDts: "declare const handler: true;",
        nativeToolSchemasJson: '{"shell":true}',
        generatedAgentContextFingerprint: "handler-context-fingerprint",
        generatedAgentContextRevision: 3,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        externalSourceHashes: ["AGENTS.md:fixture"],
      });
      const handlerTurn = store.startTurn({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        threadId: handlerThread.id,
        requestSummary: "Run generated workflow",
      });
      const workflowCommand = store.createCommand({
        turnId: handlerTurn.id,
        threadId: handlerThread.id,
        toolName: "exec_command",
        executor: "handler",
        visibility: "surface",
        title: "Run workflow",
        summary: "Launch a generated workflow.",
      });
      const workflowRun = store.recordWorkflow({
        threadId: handlerThread.id,
        commandId: workflowCommand.id,
        smithersRunId: "smithers-read-model-fixture",
        workflowName: "read_model_fixture",
        workflowSource: "saved",
        entryPath: ".svvy/workflows/read-model-fixture.tsx",
        savedEntryId: "read_model_fixture",
        status: "running",
        summary: "Generated workflow is running.",
      });
      const workflowTaskAttempt = store.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: workflowRun.smithersRunId,
        nodeId: "review",
        iteration: 0,
        attempt: 1,
        surfacePiSessionId: "workflow-task-surface-state-facade",
        title: "Review task",
        summary: "Workflow task is running.",
        kind: "agent",
        status: "running",
        smithersState: "running",
        agentId: "workflow-reviewer",
        agentModel: "gpt-5",
        agentEngine: "openai",
        generatedAgentContextFingerprint: "workflow-task-context-fingerprint",
        generatedAgentContextBinding: {
          systemPrompt: "Run the Smithers task agent.",
          svvyxGuidance: "Use the task bridge.",
          commandsDts: "declare const workflowTask: true;",
          nativeToolSchemasJson: '{"workflow":true}',
          generatedAgentContextRevision: 4,
          loadedExtensionIds: ["smithers"],
          availableExtensionIds: ["shell"],
          externalSourceHashes: ["WORKFLOW.md:fixture"],
        },
      });
      store.replaceWorkflowTaskMessages({
        workflowTaskAttemptId: workflowTaskAttempt.id,
        messages: [
          {
            id: "workflow-task-message-user-fixture",
            role: "user",
            source: "prompt",
            text: "Review the generated workflow output.",
            createdAt: "2026-06-21T12:00:01.000Z",
          },
          {
            id: "workflow-task-message-assistant-fixture",
            role: "assistant",
            source: "responseText",
            text: "The workflow output is ready.",
            createdAt: "2026-06-21T12:00:02.000Z",
          },
        ],
      });
      const fixtureTab = {
        workspaceTabId: "workspace-tab-read-model-fixture" as WorkspaceTabId,
        workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        cwd: "/tmp/svvy-state-facade-read-models" as typeof AbsolutePath.Type,
        workspaceLabel: "State facade read models",
        kind: "user" as const,
        openedAt: iso("2026-06-21T12:00:00.000Z"),
        activeLayoutId: "B" as const,
      };
      store.setWorkspaceTabs({
        activeWorkspaceTabId: fixtureTab.workspaceTabId,
        tabs: [fixtureTab],
        knownWorkspaces: [fixtureTab],
      });
      store.saveWorkspaceLayoutSlot({
        workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        layoutId: "B",
        dockviewJson: { dockview: { activeGroup: "primary" } },
        focusedPaneId: "pane-read-model-fixture" as WorkspacePaneId,
        panes: [
          {
            paneId: "pane-read-model-fixture" as WorkspacePaneId,
            target: {
              surface: "orchestrator",
              workspaceSessionId: created.workspaceSessionId,
              surfacePiSessionId: created.surfacePiSessionId,
            },
            localState: {
              scroll: { transcriptAnchorId: "message-fixture", offsetPx: 14.5 },
              timelineDensity: "comfortable",
            },
            fallbackChrome: null,
            placement: { kind: "floating", box: { x: 20, y: 30, width: 800, height: 600 } },
            restore: { kind: "ready" },
          },
        ],
        compactSurfaces: [],
      });
      const managedSnippet = store.createManagedSnippet({
        workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        title: "Review fixture",
        body: "Review $1",
        metadata: { description: "Review helper", argumentHint: "file" },
        enabled: true,
      });
      store.recordGeneratedPackageBuild({
        status: {
          packageName: "@svvyx/workflows",
          action: "written",
          refreshScope: "app-global-build",
          buildId: "generated-package-build-read-model-workflows" as GeneratedPackageBuildId,
          manifestPath: "/tmp/generated-workflows/package.json" as typeof AbsolutePath.Type,
          sourceFingerprint: "workflow-source-fingerprint",
          outputFingerprint: "workflow-output-fingerprint",
          generatedFiles: [
            {
              relativePath: "index.ts",
              path: "/tmp/generated-workflows/index.ts" as typeof AbsolutePath.Type,
            },
          ],
        },
        workflowsExports: [
          {
            kind: "agent",
            namespace: "Agents",
            exportName: "reviewerAgent",
            qualifiedName: "Agents.reviewerAgent",
            sourcePath:
              "/tmp/workflows/agents/reviewerAgent.agent.json" as typeof AbsolutePath.Type,
            generatedPath:
              "/tmp/generated-workflows/agents/reviewerAgent.ts" as typeof AbsolutePath.Type,
            generatedCode: "export const reviewerAgent = {};\n",
            agentParameters: {
              id: "workflow-reviewer",
              label: "Workflow Reviewer",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "medium" },
              instructions: "Review workflow output.",
            },
            workflowAgentId: "workflow-reviewer",
          },
          {
            kind: "prompt",
            namespace: "Prompts",
            exportName: "reviewChecklist",
            qualifiedName: "Prompts.reviewChecklist",
            sourcePath: "/tmp/workflows/prompts/reviewChecklist.mdx" as typeof AbsolutePath.Type,
            generatedPath:
              "/tmp/generated-workflows/prompts/reviewChecklist.ts" as typeof AbsolutePath.Type,
            generatedCode: 'export const reviewChecklist = "Review carefully.";\n',
            agentParameters: null,
            workflowAgentId: null,
          },
        ],
        sourceCommandId: workflowCommand.id as CommandId,
      });
      store.recordGeneratedPackageBuild({
        status: {
          packageName: "@svvyx/extensions",
          action: "written",
          refreshScope: "app-global-build",
          buildId: "generated-package-build-read-model-extensions" as GeneratedPackageBuildId,
          manifestPath: "/tmp/generated-extensions/package.json" as typeof AbsolutePath.Type,
          sourceFingerprint: "extension-source-fingerprint",
          outputFingerprint: "extension-output-fingerprint",
          generatedFiles: [
            {
              relativePath: "index.ts",
              path: "/tmp/generated-extensions/index.ts" as typeof AbsolutePath.Type,
            },
          ],
        },
        sourceCommandId: workflowCommand.id as CommandId,
      });
      store.recordLifecycleEvent({
        sessionId: created.workspaceSessionId,
        kind: "command.output",
        subjectKind: "command",
        subjectId: command.id,
        data: { stream: "stdout", source: "fixture", text: "ok\n" },
      });
      const requestInput = store.createRequestUserInputRequest({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: created.surfacePiSessionId,
        turnId: turn.id,
        commandId: command.id,
        toolItemId: "tool_request_input_fixture",
        variant: "nonblocking",
        timeout: null,
        questions: [
          {
            title: "Pick path",
            question: "Which path?",
            defaultAnswer: { kind: "custom", text: "default path" },
          },
        ],
      });
      store.finishCommand({
        commandId: command.id,
        status: "succeeded",
        summary: "Command finished",
      });
      store.recordLifecycleEvent({
        sessionId: created.workspaceSessionId,
        kind: "Extension change reverted",
        subjectKind: "session",
        subjectId: created.workspaceSessionId,
        at: "2026-06-21T12:30:00.000Z",
        data: {
          title: "Extension change reverted",
          summary: "The fixture extension change was reverted.",
          extensionId: "shell",
        },
      });
      const approvalCommand = store.createCommand({
        turnId: handlerTurn.id,
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        threadId: handlerThread.id,
        toolName: "exec_command",
        executor: "handler",
        visibility: "surface",
        title: "Approve fixture command",
        summary: "Request fixture approval.",
      });
      const approval = store.createRuntimeApprovalRequest({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        threadId: handlerThread.id,
        turnId: handlerTurn.id,
        commandId: approvalCommand.id,
        toolCallId: "tool_approval_fixture",
        toolName: "exec_command",
        approvalMode: "user",
        cwd: "/tmp/svvy-state-facade-read-models",
        command: "printf ok",
        commandFamily: "shell",
      });
      const revertedEvent = store
        .getSessionState(created.workspaceSessionId)
        .events.find((event) => event.kind === "Extension change reverted");
      if (!revertedEvent) throw new Error("Expected the navigation product-event fixture.");

      const workflowAgentObservedAt = iso("2026-06-21T12:45:00.000Z");
      const workflowAgentObservations = [
        {
          sourceId: "brokenAgent",
          path: "/tmp/workflows/agents/brokenAgent.agent.json" as typeof AbsolutePath.Type,
          sourceVersion: "sha256:broken-agent",
          fingerprint: "sha256:broken-agent",
          validationStatus: "invalid",
          diagnostics: [
            {
              severity: "error",
              code: "workflow_agent_source_invalid",
              message: "Workflow-agent source is not valid JSON.",
            },
          ],
          parameters: null,
          extensionOrder: [],
          observedAt: workflowAgentObservedAt,
        },
        {
          sourceId: "defaultAgent",
          path: "/tmp/workflows/agents/defaultAgent.agent.json" as typeof AbsolutePath.Type,
          sourceVersion: "sha256:default-agent",
          fingerprint: "sha256:default-agent",
          validationStatus: "valid",
          diagnostics: [],
          parameters: {
            id: "defaultAgent",
            label: "Default agent",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "high" },
            instructions: "Implement the requested task.",
          },
          extensionOrder: ["shell" as ExtensionId],
          observedAt: workflowAgentObservedAt,
        },
        {
          sourceId: "invalid-agent-name!",
          path: "/tmp/workflows/agents/invalid-agent-name!.agent.json" as typeof AbsolutePath.Type,
          sourceVersion: "sha256:invalid-agent",
          fingerprint: "sha256:invalid-agent",
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
          observedAt: workflowAgentObservedAt,
        },
      ] satisfies readonly WorkflowAgentSourceObservation[];
      store.reconcileRuntimeWorkflowAgentSources({
        sourceFingerprint: "sha256:workflow-agent-read-model-scan",
        observations: workflowAgentObservations,
        diagnostics: [],
        scannedAt: workflowAgentObservedAt,
      });

      const router = createWorkspaceStateRouter({
        appGlobalStore: store,
        workspaceStores: [{ store }],
      });
      const appLogStore = createAppLogStore({
        digest: testDigest,
        now: () => "2026-06-21T12:00:00.000Z",
      });
      const readModels = stateReadModelsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
      });

      const navigation = await runTestEffect(
        readModels.fetch({
          kind: "sessionNavigation",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(navigation).toMatchObject({
        kind: "sessionNavigation",
        value: {
          activeSessions: [
            {
              parentSessionId: "session_state_facade_parent",
              title: "draft text",
              preview: "Command finished",
              status: "running",
              threadIdsByStatus: {
                runningHandler: [handlerThread.id],
                runningWorkflow: [],
                waiting: [],
                troubleshooting: [],
              },
              sidebarThreads: [
                {
                  threadId: handlerThread.id,
                  status: "running-handler",
                  subtitle: {
                    badge: "workflow",
                    text: "Generated workflow is running.",
                    tone: "muted",
                  },
                  workflows: [
                    {
                      workflowRunId: workflowRun.id,
                      status: "running",
                      subtitle: {
                        badge: "workflow",
                        text: "Generated workflow is running.",
                        tone: "muted",
                      },
                    },
                  ],
                },
              ],
              commandRollups: [
                {
                  commandId: approvalCommand.id,
                  status: "waiting",
                  summary: "Waiting for approval: Run command: printf ok",
                },
                { commandId: command.id, status: "succeeded", summary: "Command finished" },
                {
                  commandId: workflowCommand.id,
                  status: "requested",
                  summary: "Launch a generated workflow.",
                },
              ],
              productEvents: [
                {
                  eventId: revertedEvent.id,
                  at: "2026-06-21T12:30:00.000Z",
                  title: "Extension change reverted",
                  summary: "The fixture extension change was reverted.",
                  subject: { kind: "session", id: created.workspaceSessionId },
                  details: {
                    title: "Extension change reverted",
                    summary: "The fixture extension change was reverted.",
                    extensionId: "shell",
                  },
                },
              ],
              titleGeneration: {
                status: "not-started",
                renameLocked: false,
                autoFrozen: false,
                manualOverride: false,
                triggeredAt: null,
                finishedAt: null,
                error: null,
              },
            },
          ],
        },
      });

      const promptHistory = await runTestEffect(
        readModels.fetch({
          kind: "promptHistory",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(promptHistory).toEqual({
        kind: "promptHistory",
        value: {
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
          entries: [
            {
              workspaceSessionId: created.workspaceSessionId,
              surfacePiSessionId: created.surfacePiSessionId,
              queueItemId: firstHistorySubmission.queuedMessage.id as QueueItemId,
              text: "  Preserve this exact prompt.  ",
              sentAt: firstHistorySubmission.queuedMessage.createdAt,
            },
            {
              workspaceSessionId: created.workspaceSessionId,
              surfacePiSessionId: created.surfacePiSessionId,
              queueItemId: secondHistorySubmission.queuedMessage.id as QueueItemId,
              text: "  Preserve this exact prompt.  ",
              sentAt: secondHistorySubmission.queuedMessage.createdAt,
            },
          ],
        },
      });
      expect(
        await runTestEffect(
          readModels.refetchInvalidation({
            descriptor: {
              scope: "workspace",
              workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
              invalidation: { model: "promptHistory" },
            },
          }),
        ),
      ).toEqual([promptHistory]);

      expect(
        await runTestEffect(
          readModels.fetch({
            kind: "artifactInspector",
            workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
            workspaceSessionId: created.workspaceSessionId as WorkspaceSessionId,
            artifactId: artifact.artifactId,
          }),
        ),
      ).toEqual({
        kind: "artifactInspector",
        value: {
          artifactId: artifact.artifactId,
          workspaceSessionId: created.workspaceSessionId,
          kind: "text",
          name: "read-model-preview.md",
          path: artifact.storedPath,
          mimeType: "text/markdown",
          byteSize: 42,
          sha256: "a".repeat(64),
          immutable: false,
          createdAt: artifact.createdAt,
          deletedAt: null,
          sourceCommandId: command.id,
          producerLabel: "Run exec_command",
        },
      });
      expect(
        await runTestEffect(
          readModels.fetch({
            kind: "artifactInspector",
            workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
            workspaceSessionId: "session-other" as WorkspaceSessionId,
            artifactId: artifact.artifactId,
          }),
        ),
      ).toEqual({ kind: "artifactInspector", value: null });

      const transcript = await runTestEffect(
        readModels.fetch({ kind: "surfaceTranscript", target: created.target }),
      );
      expect(transcript).toMatchObject({
        kind: "surfaceTranscript",
        value: {
          target: created.target,
          surfaceStatus: "running",
          promptLock: { activeTurnId: turn.id, queuedCount: 0 },
          composerDraft: { text: "draft text", attachmentIds: ["attachment-1"] },
          messages: [
            {
              role: "user",
              turnId: turn.id,
              message: { text: "Run fixture command" },
            },
          ],
          activeAssistantMessage: null,
          streamCursor: transcriptUser.cursor,
        },
      });
      const assistant = store.beginRuntimeTranscriptAssistantMessage({
        workspaceSessionId: created.workspaceSessionId as never,
        surfacePiSessionId: created.surfacePiSessionId as never,
        turnId: turn.id as never,
        api: null,
        providerId: "openai" as never,
        modelId: "gpt-5.4" as never,
        startedAt: "2026-06-21T12:00:02.000Z" as never,
        streamGenerationId: "stream-state-facade-transcript" as never,
        expectedCursor: transcriptUser.cursor,
      });
      const assistantText = store.appendRuntimeTranscriptAssistantContentDelta({
        messageId: assistant.message.messageId,
        surfacePiSessionId: created.surfacePiSessionId as never,
        streamGenerationId: "stream-state-facade-transcript" as never,
        expectedCursor: assistant.cursor,
        contentIndex: 0,
        kind: "text",
        delta: "Fixture complete.",
      });
      const streamingTranscript = await runTestEffect(
        readModels.fetch({ kind: "surfaceTranscript", target: created.target }),
      );
      expect(streamingTranscript).toMatchObject({
        kind: "surfaceTranscript",
        value: {
          messages: [{ role: "user", message: { text: "Run fixture command" } }],
          activeAssistantMessage: {
            messageId: assistant.message.messageId,
            status: "streaming",
            content: [{ kind: "text", contentIndex: 0, text: "Fixture complete." }],
          },
          streamCursor: assistantText.cursor,
        },
      });
      const assistantTool = store.upsertRuntimeTranscriptAssistantToolCall({
        messageId: assistant.message.messageId,
        surfacePiSessionId: created.surfacePiSessionId as never,
        streamGenerationId: "stream-state-facade-transcript" as never,
        expectedCursor: assistantText.cursor,
        contentIndex: 1,
        toolCallId: "tool-call-state-facade" as never,
        toolName: "exec_command",
        argumentsJson: '{"cmd":"printf ok"}',
        argumentsStatus: "accepted",
      });
      const linkedAssistant = store.linkRuntimeTranscriptAssistantToolCallCommand({
        messageId: assistant.message.messageId,
        surfacePiSessionId: created.surfacePiSessionId as never,
        streamGenerationId: "stream-state-facade-transcript" as never,
        expectedCursor: assistantTool.cursor,
        contentIndex: 1,
        toolCallId: "tool-call-state-facade" as never,
        commandId: command.id as never,
      });
      store.commitRuntimeTranscriptAssistantMessage({
        messageId: assistant.message.messageId,
        surfacePiSessionId: created.surfacePiSessionId as never,
        streamGenerationId: "stream-state-facade-transcript" as never,
        expectedCursor: linkedAssistant.cursor,
        content: linkedAssistant.message.content,
        api: "openai-responses",
        providerId: "openai" as never,
        modelId: "gpt-5.4" as never,
        responseId: null,
        usage: null,
        stopReason: "stop",
        errorMessage: null,
        piHistoryEntry: null,
        messageTimestamp: "2026-06-21T12:00:03.000Z" as never,
        finishedAt: "2026-06-21T12:00:04.000Z" as never,
      });
      store.finishTurn({
        turnId: turn.id,
        status: "completed",
        assistantMessageId: `${turn.id}:assistant`,
        assistantText: "Fixture complete.",
      });
      const settledTranscript = await runTestEffect(
        readModels.fetch({ kind: "surfaceTranscript", target: created.target }),
      );
      expect(settledTranscript).toMatchObject({
        kind: "surfaceTranscript",
        value: {
          messages: [
            {
              role: "user",
              turnId: turn.id,
              message: { text: "Run fixture command" },
            },
            {
              role: "assistant",
              turnId: turn.id,
              status: "completed",
              content: [
                { kind: "text", text: "Fixture complete." },
                { kind: "tool-call", commandId: command.id },
              ],
            },
          ],
          activeAssistantMessage: null,
        },
      });

      const commandInspector = await runTestEffect(
        readModels.fetch({
          kind: "commandInspector",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
          commandId: command.id as CommandId,
        }),
      );
      const selectorInspector = buildStructuredCommandInspector(
        store.getSessionState(created.workspaceSessionId),
        command.id,
      );
      expect(commandInspector).toEqual({
        kind: "commandInspector",
        value: selectorInspector
          ? {
              ...selectorInspector,
              target: created.target,
              acceptedArguments: { cmd: "printf ok" },
            }
          : null,
      });
      expect(
        await runTestEffect(
          readModels.refetchInvalidation({
            descriptor: {
              scope: "workspace",
              workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
              invalidation: {
                model: "commandInspector",
                ids: [command.id as CommandId],
              },
            },
          }),
        ),
      ).toEqual([commandInspector]);

      const requestInputModel = await runTestEffect(
        readModels.fetch({
          kind: "requestInput",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(requestInputModel).toMatchObject({
        kind: "requestInput",
        value: {
          requests: [{ requestId: requestInput.requestId, ownerTitle: "Expanded read models" }],
        },
      });

      const approvals = await runTestEffect(
        readModels.fetch({
          kind: "approvals",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(approvals).toMatchObject({
        kind: "approvals",
        value: { requests: [{ requestId: approval.requestId, summary: "Run command: printf ok" }] },
      });

      const agents = await runTestEffect(readModels.fetch({ kind: "agents" }));
      expect(agents.kind).toBe("agents");
      if (agents.kind !== "agents") throw new Error("Expected agents read model.");
      expect(agents.value.workflowAgents).toEqual([
        {
          sourceId: "brokenAgent",
          path: "/tmp/workflows/agents/brokenAgent.agent.json",
          sourceVersion: "sha256:broken-agent",
          fingerprint: "sha256:broken-agent",
          validationStatus: "invalid",
          diagnostics: [
            {
              severity: "error",
              code: "workflow_agent_source_invalid",
              message: "Workflow-agent source is not valid JSON.",
            },
          ],
          parameters: null,
          extensionOrder: [],
          observedAt: workflowAgentObservedAt,
          updatedAt: workflowAgentObservedAt,
          builtin: false,
          deletable: true,
        },
        {
          sourceId: "defaultAgent",
          path: "/tmp/workflows/agents/defaultAgent.agent.json",
          sourceVersion: "sha256:default-agent",
          fingerprint: "sha256:default-agent",
          validationStatus: "valid",
          diagnostics: [],
          parameters: {
            id: "defaultAgent",
            label: "Default agent",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "high" },
            instructions: "Implement the requested task.",
          },
          extensionOrder: ["shell"],
          observedAt: workflowAgentObservedAt,
          updatedAt: workflowAgentObservedAt,
          builtin: true,
          deletable: false,
        },
        {
          sourceId: "invalid-agent-name!",
          path: "/tmp/workflows/agents/invalid-agent-name!.agent.json",
          sourceVersion: "sha256:invalid-agent",
          fingerprint: "sha256:invalid-agent",
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
          observedAt: workflowAgentObservedAt,
          updatedAt: workflowAgentObservedAt,
          builtin: false,
          deletable: false,
        },
      ] as unknown as typeof agents.value.workflowAgents);
      expect(agents.value.configuredProfiles).toEqual([
        {
          profileId: "thread-handler",
          actor: "handler",
          name: "Thread handler",
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          reasoning: { effort: "low" },
          followComposer: false,
          extensionUsage: { shell: "loaded", smithers: "available" },
          extensionOrder: ["shell", "smithers"],
          position: 0,
          updatedAt: threadHandlerProfile.updatedAt,
          builtin: true,
          locked: true,
          deletable: false,
        },
        {
          profileId: "default-orchestrator",
          actor: "orchestrator",
          name: "Default orchestrator",
          providerId: "openai",
          modelId: "gpt-5.4",
          reasoning: { effort: "high" },
          followComposer: true,
          extensionUsage: { git: "unavailable" },
          extensionOrder: ["git", "shell"],
          position: 0,
          updatedAt: sparseDefaultOrchestratorProfile.updatedAt,
          builtin: true,
          locked: true,
          deletable: false,
        },
        {
          profileId: "review-orchestrator",
          actor: "orchestrator",
          name: "Review orchestrator",
          providerId: "anthropic",
          modelId: "claude-opus-4-5",
          reasoning: { effort: "medium" },
          followComposer: false,
          extensionUsage: { shell: "available", smithers: "unavailable" },
          extensionOrder: ["smithers", "shell"],
          position: 1,
          updatedAt: customOrchestratorProfile.updatedAt,
          builtin: false,
          locked: false,
          deletable: true,
        },
      ] as unknown as typeof agents.value.configuredProfiles);
      expect(agents.value.actorExtensionDefaults).toEqual([
        {
          actor: "orchestrator",
          extensionUsage: { shell: "loaded", git: "available" },
          extensionOrder: ["shell", "git"],
          updatedAt: orchestratorExtensionDefaults.updatedAt,
        },
        {
          actor: "workflow-task",
          extensionUsage: { smithers: "loaded" },
          extensionOrder: ["smithers", "shell"],
          updatedAt: workflowTaskExtensionDefaults.updatedAt,
        },
      ] as unknown as typeof agents.value.actorExtensionDefaults);
      expect(agents.value.bindings).toEqual([
        expect.objectContaining({
          ownerKind: "session",
          ownerId: created.workspaceSessionId,
          surfacePiSessionId: created.surfacePiSessionId,
          actor: "orchestrator",
          profileId: "default-orchestrator",
          name: "Default orchestrator",
          providerId: "openai",
          modelId: "gpt-5.4",
          reasoning: { effort: "high" },
          followComposer: true,
          source: "surface-binding",
        }),
        expect.objectContaining({
          ownerKind: "thread",
          ownerId: handlerThread.id,
          surfacePiSessionId: handlerThread.surfacePiSessionId,
          actor: "handler",
          profileId: "thread-handler",
          name: "Thread handler",
          providerId: "openai",
          modelId: "gpt-5.4-mini",
          reasoning: { effort: "low" },
          loadedExtensionIds: ["shell"],
          availableExtensionIds: ["smithers"],
          generatedAgentContextFingerprint: "handler-context-fingerprint",
          source: "handler-thread",
        }),
        expect.objectContaining({
          ownerKind: "workflow-task-attempt",
          ownerId: workflowTaskAttempt.id,
          surfacePiSessionId: workflowTaskAttempt.surfacePiSessionId,
          actor: "workflow-task",
          profileId: "workflow-reviewer",
          providerId: "openai",
          modelId: "gpt-5",
          generatedAgentContextFingerprint: "workflow-task-context-fingerprint",
          source: "workflow-task-attempt",
        }),
      ]);
      expect(agents.value.generatedContextPreviews).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ownerKind: "thread",
            ownerId: handlerThread.id,
            actorKind: "handler",
            generatedAgentContextFingerprint: "handler-context-fingerprint",
          }),
          expect.objectContaining({
            ownerKind: "workflow-task-attempt",
            ownerId: workflowTaskAttempt.id,
            actorKind: "workflow-task",
            generatedAgentContextFingerprint: "workflow-task-context-fingerprint",
          }),
        ]),
      );

      const resetWorkflowTaskUsage = store.resetActorExtensionDefaults({
        actor: "workflow-task",
        reset: "usage",
      });
      const resetOrchestratorOrder = store.resetActorExtensionDefaults({
        actor: "orchestrator",
        reset: "order",
      });
      const agentsAfterDefaultResets = await runTestEffect(readModels.fetch({ kind: "agents" }));
      expect(agentsAfterDefaultResets).toMatchObject({
        kind: "agents",
        value: {
          configuredProfiles: agents.value.configuredProfiles,
          actorExtensionDefaults: [
            {
              actor: "orchestrator",
              extensionUsage: { shell: "loaded", git: "available" },
              extensionOrder: [],
              updatedAt: resetOrchestratorOrder.updatedAt,
            },
            {
              actor: "workflow-task",
              extensionUsage: {},
              extensionOrder: ["smithers", "shell"],
              updatedAt: resetWorkflowTaskUsage.updatedAt,
            },
          ],
        },
      });

      store.reconcileExtensionRegistryObservation({
        observation: extensionRegistryObservation(
          ["shell" as ExtensionId, "smithers" as ExtensionId],
          [],
          {
            shell: [
              {
                id: "shell-cli",
                requirementFingerprint: "sha256:shell-cli-v1",
                binary: "shell",
                package: null,
                required: true,
                defaultVersion: null,
                versionCommand: null,
                installCommand: null,
                nodeRequirement: null,
              },
            ],
            smithers: [
              {
                id: "smithers-cli",
                requirementFingerprint: "sha256:smithers-cli-v1",
                binary: "smithers",
                package: "smithers-orchestrator",
                required: false,
                defaultVersion: "0.22.0",
                versionCommand: "smithers --version",
                installCommand: null,
                nodeRequirement: null,
              },
            ],
          },
          {
            smithers: [
              {
                name: "SMITHERS_TOKEN",
                required: true,
                secret: true,
                description: "Smithers token",
                hasDefault: false,
              },
            ],
          },
        ),
        observedAt: iso("2026-06-21T12:30:00.000Z"),
      });
      const registryWithDependency = store.readExtensionRegistryObservation()!.observation;
      const shellDependency = {
        kind: "dependency" as const,
        packageManager: "bun" as const,
        source: "npm" as const,
        name: "shell-runtime",
        version: "1.0.0",
        integrity: null,
        resolution: null,
      };
      store.reconcileExtensionRegistryObservation({
        observation: {
          ...registryWithDependency,
          observations: registryWithDependency.observations.map((observation) =>
            observation.extensionId === "shell"
              ? { ...observation, dependencyDeclarations: [shellDependency] }
              : observation,
          ),
        },
        observedAt: iso("2026-06-21T12:30:00.000Z"),
      });
      store.recordExtensionDependencyApproval({
        dependency: shellDependency,
        approvedBy: "user",
        approvedAt: iso("2026-06-21T12:30:00.000Z"),
      });
      const buildRegistry = store.readExtensionRegistryObservation()!.observation;
      const extensionsWithoutBuildEvidence = await runTestEffect(
        readModels.fetch({ kind: "extensions" }),
      );
      expect(extensionsWithoutBuildEvidence).toMatchObject({
        kind: "extensions",
        value: {
          records: [
            {
              extensionId: "shell",
              buildAuthorityStatus: "missing",
              buildObservation: null,
              contextReady: false,
              runtimeReady: false,
              readiness: "not-ready",
              generatedPackageStatus: "ready",
            },
            {
              extensionId: "smithers",
              buildAuthorityStatus: "missing",
              contextReady: false,
              runtimeReady: false,
            },
          ],
        },
      });
      store.reconcileExtensionSourceBuildEvidence({
        registryAggregateFingerprint: buildRegistry.aggregateFingerprint,
        observations: buildRegistry.observations.map(
          (observation): ExtensionSourceBuildObservation => ({
            extensionId: observation.extensionId,
            category: observation.category,
            buildRequirement: "not-required",
            sourceStatus: "materialized",
            sourceFingerprint:
              observation.sourceFingerprint as ExtensionSourceBuildObservation["sourceFingerprint"],
            currentBuildStatus: "not-required",
            currentBuild: null,
            buildRequired: false,
            diagnostics: [],
          }),
        ),
        observedAt: iso("2026-06-21T12:30:00.500Z"),
      });
      const extensionsWithoutCliFacts = await runTestEffect(
        readModels.fetch({ kind: "extensions" }),
      );
      expect(extensionsWithoutCliFacts).toMatchObject({
        kind: "extensions",
        value: {
          records: [
            {
              extensionId: "shell",
              readiness: "not-ready",
              cliReadiness: [
                {
                  authorityStatus: "missing",
                  status: "unknown",
                  usable: false,
                  blocking: true,
                },
              ],
              dependencyRequirements: [
                {
                  name: "shell-runtime",
                  approval: "approved",
                  install: "unknown",
                },
              ],
            },
            { extensionId: "smithers", readiness: "not-ready" },
          ],
        },
      });
      store.reconcileExtensionDependencyReadiness({
        registryAggregateFingerprint: "sha256:shell-smithers",
        readiness: [
          {
            extensionId: "smithers" as ExtensionId,
            requirementId: "smithers-cli",
            requirementFingerprint: "sha256:smithers-cli-v1",
            status: "missing",
            detectedVersion: null,
            expectedVersion: "0.22.0",
            diagnostics: ["optional CLI missing"],
            checkedAt: iso("2026-06-21T12:30:01.000Z"),
          },
          {
            extensionId: "shell" as ExtensionId,
            requirementId: "shell-cli",
            requirementFingerprint: "sha256:shell-cli-v1",
            status: "update-available",
            detectedVersion: "1.0.0",
            expectedVersion: null,
            diagnostics: [],
            checkedAt: iso("2026-06-21T12:30:01.000Z"),
          },
        ],
        recordedAt: iso("2026-06-21T12:30:02.000Z"),
      });
      const extensions = await runTestEffect(readModels.fetch({ kind: "extensions" }));
      expect(extensions).toMatchObject({
        kind: "extensions",
        value: {
          aggregateFingerprint: "sha256:shell-smithers",
          diagnostics: [],
          observedAt: "2026-06-21T12:30:00.000Z",
          records: [
            {
              extensionId: "shell",
              buildAuthorityStatus: "current",
              buildRequired: false,
              contextReady: true,
              runtimeReady: false,
              readiness: "not-ready",
              loadedByProfileIds: ["thread-handler"],
              availableByProfileIds: ["review-orchestrator"],
              generatedPackageStatus: "ready",
              cliReadiness: [
                {
                  requirementId: "shell-cli",
                  authorityStatus: "current",
                  status: "update-available",
                  usable: true,
                  blocking: false,
                },
              ],
            },
            {
              extensionId: "smithers",
              readiness: "not-ready",
              loadedByProfileIds: [],
              availableByProfileIds: ["thread-handler"],
              generatedPackageStatus: "ready",
              cliReadiness: [
                {
                  requirementId: "smithers-cli",
                  authorityStatus: "current",
                  status: "missing",
                  usable: false,
                  blocking: false,
                },
              ],
            },
          ],
          dependencyReadiness: [
            {
              extensionId: "shell",
              requirementId: "shell-cli",
              requirementFingerprint: "sha256:shell-cli-v1",
              status: "update-available",
            },
            {
              extensionId: "smithers",
              requirementId: "smithers-cli",
              requirementFingerprint: "sha256:smithers-cli-v1",
              status: "missing",
            },
          ],
        },
      } as unknown as typeof extensions);

      const currentRegistry = store.readExtensionRegistryObservation()!;
      store.reconcileExtensionRegistryObservation({
        observation: {
          ...currentRegistry.observation,
          observations: currentRegistry.observation.observations.map((observation) =>
            observation.extensionId === "shell"
              ? {
                  ...observation,
                  cliDeclarations: observation.cliDeclarations.map((declaration) => ({
                    ...declaration,
                    requirementFingerprint: "sha256:shell-cli-v2",
                  })),
                }
              : observation,
          ),
        },
        observedAt: iso("2026-06-21T12:31:02.000Z"),
      });
      const extensionsWithStaleCliFact = await runTestEffect(
        readModels.fetch({ kind: "extensions" }),
      );
      expect(extensionsWithStaleCliFact.kind).toBe("extensions");
      if (extensionsWithStaleCliFact.kind !== "extensions") {
        throw new Error("Expected extensions read model.");
      }
      expect(
        extensionsWithStaleCliFact.value.records.find((record) => record.extensionId === "shell"),
      ).toMatchObject({
        extensionId: "shell",
        readiness: "not-ready",
        cliReadiness: [
          {
            authorityStatus: "requirement-fingerprint-mismatch",
            status: "unknown",
            readiness: null,
            blocking: true,
          },
        ],
      });

      const registryBeforeAuthorityChange = store.readExtensionRegistryObservation()!;
      store.reconcileExtensionRegistryObservation({
        observation: {
          ...registryBeforeAuthorityChange.observation,
          aggregateFingerprint: "sha256:shell-smithers-v2",
        },
        observedAt: iso("2026-06-21T12:32:02.000Z"),
      });
      const extensionsWithStaleBuildBatch = await runTestEffect(
        readModels.fetch({ kind: "extensions" }),
      );
      expect(extensionsWithStaleBuildBatch.kind).toBe("extensions");
      if (extensionsWithStaleBuildBatch.kind !== "extensions") {
        throw new Error("Expected extensions read model.");
      }
      expect(
        extensionsWithStaleBuildBatch.value.records.find(
          (record) => record.extensionId === "shell",
        ),
      ).toMatchObject({
        buildAuthorityStatus: "registry-fingerprint-mismatch",
        buildObservation: null,
        contextReady: false,
        runtimeReady: false,
        readiness: "not-ready",
      });

      const snippets = await runTestEffect(
        readModels.fetch({
          kind: "snippets",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(snippets).toEqual({
        kind: "snippets",
        value: {
          managed: [
            {
              id: managedSnippet.id as SnippetId,
              source: "svvy",
              title: "Review fixture",
              body: "Review $1",
              metadata: { description: "Review helper", argumentHint: "file" },
              enabled: true,
              path: null,
              updatedAt: managedSnippet.updatedAt,
            },
          ],
          discovered: [],
          snippets: [
            {
              id: managedSnippet.id as SnippetId,
              source: "svvy",
              title: "Review fixture",
              body: "Review $1",
              metadata: { description: "Review helper", argumentHint: "file" },
              enabled: true,
              path: null,
              updatedAt: managedSnippet.updatedAt,
            },
          ],
        },
      });

      const workflowsGenerated = await runTestEffect(
        readModels.fetch({ kind: "workflowsGenerated" }),
      );
      expect(workflowsGenerated).toMatchObject({
        kind: "workflowsGenerated",
        value: {
          packageName: "@svvyx/workflows",
          facts: [
            {
              packageName: "@svvyx/workflows",
              status: "ready",
              buildId: "generated-package-build-read-model-workflows",
            },
          ],
          exports: [
            {
              kind: "agent",
              namespace: "Agents",
              exportName: "reviewerAgent",
              qualifiedName: "Agents.reviewerAgent",
              sourcePath: "/tmp/workflows/agents/reviewerAgent.agent.json",
              generatedPath: "/tmp/generated-workflows/agents/reviewerAgent.ts",
              generatedCode: "export const reviewerAgent = {};\n",
              agentParameters: {
                id: "workflow-reviewer",
                label: "Workflow Reviewer",
                provider: "openai",
                model: "gpt-5.4",
                reasoning: { effort: "medium" },
                instructions: "Review workflow output.",
              },
              workflowAgentId: "workflow-reviewer",
            },
            {
              kind: "prompt",
              namespace: "Prompts",
              exportName: "reviewChecklist",
              qualifiedName: "Prompts.reviewChecklist",
              sourcePath: "/tmp/workflows/prompts/reviewChecklist.mdx",
              generatedPath: "/tmp/generated-workflows/prompts/reviewChecklist.ts",
              generatedCode: 'export const reviewChecklist = "Review carefully.";\n',
              agentParameters: null,
              workflowAgentId: null,
            },
          ],
        },
      });
      expect(
        await runTestEffect(
          readModels.fetch({
            kind: "workflowsGenerated",
            buildId: "generated-package-build-not-current",
          }),
        ),
      ).toEqual({
        kind: "workflowsGenerated",
        value: {
          packageName: "@svvyx/workflows",
          facts: [],
          exports: [],
        },
      });

      const handlerInspector = await runTestEffect(
        readModels.fetch({
          kind: "handlerInspector",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
          threadId: handlerThread.id as ThreadId,
        }),
      );
      expect(handlerInspector).toMatchObject({
        kind: "handlerInspector",
        value: {
          threadId: handlerThread.id,
          title: "Review docs",
          workflowRuns: [{ workflowRunId: workflowRun.id, workflowName: "read_model_fixture" }],
        },
      });

      const workflowTaskInspector = await runTestEffect(
        readModels.fetch({
          kind: "workflowTaskAttemptInspector",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
          workflowTaskAttemptId: workflowTaskAttempt.id as WorkflowTaskAttemptId,
        }),
      );
      expect(workflowTaskInspector).toMatchObject({
        kind: "workflowTaskAttemptInspector",
        value: {
          workflowTaskAttemptId: workflowTaskAttempt.id,
          title: "Review task",
          transcript: [
            { role: "user", text: "Review the generated workflow output." },
            { role: "assistant", text: "The workflow output is ready." },
          ],
        },
      });

      const workspaceChrome = await runTestEffect(readModels.fetch({ kind: "workspaceChrome" }));
      expect(workspaceChrome).toMatchObject({
        kind: "workspaceChrome",
        value: {
          activeWorkspaceTabId: "workspace-tab-read-model-fixture",
          tabs: [
            {
              workspaceTabId: "workspace-tab-read-model-fixture",
              workspaceId: "workspace_state_facade_read_models",
              workspaceLabel: "State facade read models",
              kind: "user",
              activeLayoutId: "B",
            },
          ],
          knownWorkspaces: [
            {
              workspaceTabId: "workspace-tab-read-model-fixture",
              workspaceId: "workspace_state_facade_read_models",
              cwd: "/tmp/svvy-state-facade-read-models",
              workspaceLabel: "State facade read models",
              kind: "user",
              activeLayoutId: "B",
            },
          ],
        },
      });
      const workspaceLayout = await runTestEffect(
        readModels.fetch({
          kind: "workspaceLayout",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      if (workspaceLayout.kind !== "workspaceLayout") {
        throw new Error("Expected workspaceLayout read model.");
      }
      const repeatedWorkspaceLayout = await runTestEffect(
        readModels.fetch({
          kind: "workspaceLayout",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(repeatedWorkspaceLayout).toEqual(workspaceLayout);
      expect(workspaceLayout.value.slots).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workspaceId: "workspace_state_facade_read_models",
            layoutId: "B",
            initialized: true,
            focusedPaneId: "pane-read-model-fixture",
            dockviewJson: { dockview: { activeGroup: "primary" } },
            panes: expect.arrayContaining([
              expect.objectContaining({
                paneId: "pane-read-model-fixture",
                target: expect.objectContaining({
                  surface: "orchestrator",
                  surfacePiSessionId: created.surfacePiSessionId,
                }),
              }),
            ]),
          }),
          expect.objectContaining({
            workspaceId: "workspace_state_facade_read_models",
            layoutId: "A",
          }),
          expect.objectContaining({
            workspaceId: "workspace_state_facade_read_models",
            layoutId: "C",
          }),
        ]),
      );

      const refetched = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: {
            scope: "workspace",
            workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
            invalidation: { model: "runtimeApprovals", ids: [approval.requestId as never] },
          },
        }),
      );
      expect(refetched.map((result) => result.kind)).toEqual(["approvals"]);

      const secondHalfRefetched = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: {
            scope: "workspace",
            workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
            invalidation: { model: "workspaceLayout", ids: ["B"] },
          },
        }),
      );
      expect(secondHalfRefetched.map((result) => result.kind)).toEqual(["workspaceLayout"]);

      const chromeRefetched = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: { scope: "app", invalidation: { model: "workspaceChrome" } },
        }),
      );
      expect(chromeRefetched.map((result) => result.kind)).toEqual(["workspaceChrome"]);

      const baseline = await runTestEffect(
        readModels.rebaseline({
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
          reason: "renderer-startup",
        }),
      );
      expect(baseline.workspaces.map((result) => result.kind)).toContain("sessionNavigation");
      expect(baseline.workspaces.map((result) => result.kind)).toContain("requestInput");
      expect(baseline.workspaces.map((result) => result.kind)).toContain("approvals");
      expect(baseline.app.map((result) => result.kind)).toEqual(
        expect.arrayContaining(["agents", "extensions", "workflowsGenerated", "workspaceChrome"]),
      );
      expect(baseline.workspaces.map((result) => result.kind)).toEqual(
        expect.arrayContaining(["snippets", "workspaceLayout"]),
      );
    } finally {
      store.close();
    }
  });

  it("enforces locked profile policy and keeps handler usage independent from actor defaults", () => {
    const store = createStructuredSessionStateStore({
      databasePath: ":memory:",
      digest: testDigest,
      now: () => "2026-07-11T10:00:00.000Z",
      workspace: {
        id: "workspace_agent_profile_policy" as WorkspaceId,
        label: "Agent profile policy",
        cwd: "/tmp/svvy-agent-profile-policy" as typeof AbsolutePath.Type,
        artifactDir: "/tmp/svvy-agent-profile-policy-artifacts" as typeof AbsolutePath.Type,
      },
    });
    try {
      store.updateOrchestratorProfile({
        profile: {
          profileId: "default-orchestrator" as AgentProfileId,
          name: "Default orchestrator",
          providerId: openaiProviderId,
          modelId: "gpt-5.4" as ModelId,
          extensionUsage: { ["shell" as ExtensionId]: "available" },
          followComposer: false,
        },
      });
      store.updateOrchestratorProfile({
        profile: {
          profileId: "custom-orchestrator" as AgentProfileId,
          name: "Custom orchestrator",
          providerId: openaiProviderId,
          modelId: "gpt-5.4" as ModelId,
          extensionUsage: {},
          followComposer: false,
        },
      });
      store.updateThreadHandlerProfile({
        profile: {
          profileId: "thread-handler" as AgentProfileId,
          name: "Thread handler",
          providerId: openaiProviderId,
          modelId: "gpt-5.4-mini" as ModelId,
          extensionUsage: {},
        },
      });

      expect(() =>
        store.deleteOrchestratorProfile({
          profileId: "default-orchestrator" as AgentProfileId,
        }),
      ).toThrow("locked and cannot be deleted");
      expect(() =>
        store.reorderOrchestratorProfiles({
          profileIds: ["custom-orchestrator", "default-orchestrator"] as AgentProfileId[],
        }),
      ).toThrow("locked in the first position");
      expect(() =>
        store.reorderOrchestratorProfiles({
          profileIds: ["default-orchestrator"] as AgentProfileId[],
        }),
      ).toThrow("every configured profile exactly once");
      expect(() =>
        store.reorderOrchestratorProfiles({
          profileIds: ["default-orchestrator", "custom-orchestrator"] as AgentProfileId[],
        }),
      ).not.toThrow();

      store.setAgentActorExtensionDefaults({
        actor: "orchestrator",
        extensionUsage: { shell: "loaded" },
        extensionOrder: [],
      });
      store.setProfileExtensionUsage({
        actor: "orchestrator",
        profileId: "default-orchestrator" as AgentProfileId,
        extensionId: "shell" as ExtensionId,
        usage: "loaded",
      });
      store.setProfileExtensionUsage({
        actor: "handler",
        profileId: "thread-handler" as AgentProfileId,
        extensionId: "shell" as ExtensionId,
        usage: "loaded",
      });

      const profiles = store.listAgentProfiles();
      expect(
        profiles.find((profile) => profile.profileId === "default-orchestrator")?.extensionUsage,
      ).toEqual({});
      expect(
        profiles.find((profile) => profile.profileId === "thread-handler")?.extensionUsage,
      ).toEqual({ shell: "loaded" });
    } finally {
      store.close();
    }
  });

  it("commits full actor extension defaults idempotently with agents invalidation", async () => {
    const workspaceId = "workspace_actor_extension_defaults" as WorkspaceId;
    const store = createStructuredSessionStateStore({
      databasePath: ":memory:",
      digest: testDigest,
      now: () => "2026-07-11T10:00:00.000Z",
      workspace: {
        id: workspaceId,
        label: "Actor extension defaults",
        cwd: "/tmp/svvy-actor-extension-defaults" as typeof AbsolutePath.Type,
        artifactDir: "/tmp/svvy-actor-extension-defaults-artifacts" as typeof AbsolutePath.Type,
      },
    });
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-07-11T10:00:00.000Z",
    });
    const router = createWorkspaceStateRouter({
      appGlobalStore: store,
      workspaceStores: [{ store }],
    });
    const service = stateCommandsFromRouter({
      router,
      appLogs: appLogStateFromStore(appLogStore),
      secretStoreMutation: unavailableSecretStoreMutation,
    });
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(
      Layer.merge(
        Layer.succeed(StateCommands, service),
        Layer.succeed(
          StateCommandPostCommitNotificationPort,
          StateCommandPostCommitNotificationPort.of({
            notifyCommittedStateCommand: (input) =>
              Effect.sync(() => {
                published.push(input);
                return {
                  receipt: input.receipt,
                  acceptedDescriptorCount: input.descriptors.length,
                  rebaselineRequired: false,
                };
              }),
          }),
        ),
      ),
    );

    try {
      const commands = createStateCommandsFacade(managedRuntime);
      const input = {
        actor: "workflow-task" as const,
        extensionUsage: {
          ["shell" as ExtensionId]: "loaded" as const,
          ["smithers" as ExtensionId]: "available" as const,
        },
        extensionOrder: ["smithers" as ExtensionId, "shell" as ExtensionId],
        clientSubmission: {
          clientRequestId: "actor-extension-defaults-command" as RuntimeClientRequestId,
          source: "test" as RuntimeClientSubmissionSource,
        },
      };

      const applied = await commands.agentProfiles.setActorExtensionDefaults(input);
      const duplicate = await commands.agentProfiles.setActorExtensionDefaults(input);

      expect(applied.receipt).toMatchObject({
        clientRequestId: "actor-extension-defaults-command",
        outcome: "applied",
      });
      expect(duplicate.receipt).toEqual({ ...applied.receipt, outcome: "duplicate" });
      expect(
        store.listAgentActorExtensionDefaults().find((record) => record.actor === "workflow-task"),
      ).toMatchObject({
        actor: "workflow-task",
        extensionUsage: { shell: "loaded", smithers: "available" },
        extensionOrder: ["smithers", "shell"],
      });
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        operation: "stateCommands.agentProfiles.setActorExtensionDefaults",
        descriptors: [{ scope: "app", invalidation: { model: "agents" } }],
      });
    } finally {
      await managedRuntime.dispose();
      appLogStore.close();
      store.close();
    }
  });

  it("commits typed session navigation commands with explicit routing and idempotent receipts", async () => {
    let idSeq = 0;
    let cursor = Date.parse("2026-07-11T10:00:00.000Z");
    const workspaceId = "workspace_session_navigation_commands" as WorkspaceId;
    const store = createStructuredSessionStateStore({
      databasePath: ":memory:",
      idFactory: (prefix) => `${prefix}-session-navigation-${++idSeq}`,
      now: () => {
        const value = new Date(cursor).toISOString();
        cursor += 1_000;
        return value;
      },
      workspace: {
        id: workspaceId,
        label: "Session navigation commands",
        cwd: "/tmp/svvy-session-navigation-commands" as typeof AbsolutePath.Type,
        artifactDir: "/tmp/svvy-session-navigation-command-artifacts" as typeof AbsolutePath.Type,
      },
    });
    const created = store.createOrchestratorSurface(
      orchestratorStateInput(workspaceId, "Session navigation commands"),
    );
    const workspaceSessionId = created.workspaceSessionId as WorkspaceSessionId;
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-07-11T10:00:00.000Z",
    });
    const router = createWorkspaceStateRouter({
      appGlobalStore: store,
      workspaceStores: [{ store }],
    });
    const service = stateCommandsFromRouter({
      router,
      appLogs: appLogStateFromStore(appLogStore),
      secretStoreMutation: unavailableSecretStoreMutation,
    });
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(
      Layer.merge(
        Layer.succeed(StateCommands, service),
        Layer.succeed(
          StateCommandPostCommitNotificationPort,
          StateCommandPostCommitNotificationPort.of({
            notifyCommittedStateCommand: (input) =>
              Effect.sync(() => {
                published.push(input);
                return {
                  receipt: input.receipt,
                  acceptedDescriptorCount: input.descriptors.length,
                  rebaselineRequired: false,
                };
              }),
          }),
        ),
      ),
    );
    const submission = (clientRequestId: string) => ({
      clientRequestId: clientRequestId as RuntimeClientRequestId,
      source: "test" as RuntimeClientSubmissionSource,
    });

    try {
      const commands = createStateCommandsFacade(managedRuntime);
      const pinnedInput = {
        workspaceId,
        workspaceSessionId,
        pinned: true,
        clientSubmission: submission("session-navigation-pin"),
      };
      const pinned = await commands.sessionNavigation.setPinned(pinnedInput);
      const duplicate = await commands.sessionNavigation.setPinned(pinnedInput);
      await commands.sessionNavigation.setPinned({
        ...pinnedInput,
        pinned: false,
        clientSubmission: submission("session-navigation-unpin"),
      });
      await commands.sessionNavigation.setArchived({
        workspaceId,
        workspaceSessionId,
        archived: true,
        clientSubmission: submission("session-navigation-archive"),
      });
      await commands.sessionNavigation.setArchived({
        workspaceId,
        workspaceSessionId,
        archived: false,
        clientSubmission: submission("session-navigation-unarchive"),
      });
      await commands.sessionNavigation.markUnread({
        workspaceId,
        workspaceSessionId,
        clientSubmission: submission("session-navigation-unread"),
      });
      expect(store.getSessionState(workspaceSessionId).session.unreadReason).toBe("manual");
      await commands.sessionNavigation.markRead({
        workspaceId,
        workspaceSessionId,
        clientSubmission: submission("session-navigation-read"),
      });
      await commands.sessionNavigation.setSectionState({
        workspaceId,
        section: "archived",
        collapsed: false,
        sizePx: 420.5,
        clientSubmission: submission("session-navigation-section"),
      });

      const snapshot = store.getSessionState(workspaceSessionId);
      expect(pinned.receipt).toMatchObject({
        clientRequestId: "session-navigation-pin",
        outcome: "applied",
      });
      expect(duplicate.receipt).toEqual({
        ...pinned.receipt,
        outcome: "duplicate",
      });
      expect(snapshot.session).toMatchObject({
        pinnedAt: null,
        archivedAt: null,
        unreadAt: null,
        unreadReason: null,
      });
      expect(snapshot.session.lastReadAt).not.toBeNull();
      expect(store.getWorkspaceSidebarState()).toMatchObject({
        archivedGroupCollapsed: false,
        archivedGroupSizePx: 421,
      });
      expect(published).toHaveLength(7);
      expect(
        published.map((notification) => ({
          operation: notification.operation,
          descriptors: notification.descriptors,
        })),
      ).toEqual(
        [
          "setPinned",
          "setPinned",
          "setArchived",
          "setArchived",
          "markUnread",
          "markRead",
          "setSectionState",
        ].map((method) => ({
          operation: `stateCommands.sessionNavigation.${method}`,
          descriptors: [
            { scope: "workspace", workspaceId, invalidation: { model: "sessionNavigation" } },
          ],
        })),
      );

      await expect(
        runTestEffect(
          service.sessionNavigation.setPinned({
            workspaceId,
            workspaceSessionId: "session_from_another_workspace" as WorkspaceSessionId,
            pinned: true,
            clientSubmission: submission("session-navigation-cross-workspace"),
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      expect(store.listSessionStates().map((state) => state.session.id)).not.toContain(
        "session_from_another_workspace",
      );
      commands.close();
    } finally {
      await managedRuntime.dispose();
      appLogStore.close();
      store.close();
    }
  });

  it("routes every managed-snippet mutation by explicit workspace identity", async () => {
    const makeStore = (workspaceId: WorkspaceId) =>
      createStructuredSessionStateStore({
        databasePath: ":memory:",
        digest: testDigest,
        idFactory: (prefix) => `${prefix}-${workspaceId}`,
        now: () => "2026-06-21T12:00:00.000Z",
        workspace: {
          id: workspaceId,
          label: workspaceId,
          cwd: `/tmp/${workspaceId}` as typeof AbsolutePath.Type,
          artifactDir: `/tmp/${workspaceId}-artifacts` as typeof AbsolutePath.Type,
        },
      });
    const appGlobalStore = makeStore("workspace_snippets_app_global" as WorkspaceId);
    const workspaceId = "workspace_snippets_routed" as WorkspaceId;
    const workspaceStore = makeStore(workspaceId);
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-06-21T12:00:00.000Z",
    });

    try {
      const router = createWorkspaceStateRouter({
        appGlobalStore,
        workspaceStores: [{ store: workspaceStore }],
      });
      const commands = stateCommandsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
        secretStoreMutation: unavailableSecretStoreMutation,
      });
      const readModels = stateReadModelsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
      });
      const created = await runTestEffect(
        commands.snippets.createManaged({
          workspaceId,
          title: "  Routed snippet  ",
          body: "Initial body",
          metadata: { description: null, argumentHint: null },
          enabled: true,
        }),
      );
      const snippetId = created.value.snippetId;
      const updated = await runTestEffect(
        commands.snippets.updateManaged({
          workspaceId,
          snippetId,
          patch: { body: "Updated body" },
        }),
      );
      const disabled = await runTestEffect(
        commands.snippets.setEnabled({ workspaceId, snippetId, enabled: false }),
      );

      expect(appGlobalStore.listSnippets({ workspaceId: appGlobalStore.workspaceId })).toEqual([]);
      expect(workspaceStore.listSnippets({ workspaceId })).toMatchObject([
        { id: snippetId, title: "Routed snippet", body: "Updated body", enabled: false },
      ]);
      expect(
        await runTestEffect(readModels.fetch({ kind: "snippets", workspaceId })),
      ).toMatchObject({
        kind: "snippets",
        value: {
          managed: [
            { id: snippetId, title: "Routed snippet", body: "Updated body", enabled: false },
          ],
        },
      });
      expect([...updated.afterCommit, ...disabled.afterCommit]).toEqual([
        {
          scope: "workspace",
          workspaceId,
          invalidation: { model: "snippets", ids: [snippetId] },
        },
        {
          scope: "workspace",
          workspaceId,
          invalidation: { model: "snippets", ids: [snippetId] },
        },
      ]);

      const deleted = await runTestEffect(
        commands.snippets.deleteManaged({ workspaceId, snippetId }),
      );
      expect(workspaceStore.listSnippets({ workspaceId })).toEqual([]);
      expect(deleted.afterCommit).toEqual([
        {
          scope: "workspace",
          workspaceId,
          invalidation: { model: "snippets", ids: [snippetId] },
        },
      ]);
      const revisionAfterDelete = workspaceStore.readCurrentStateRevision();
      await expect(
        runTestEffect(
          commands.snippets.updateManaged({
            workspaceId,
            snippetId,
            patch: { body: "Must not commit" },
          }),
        ),
      ).rejects.toMatchObject({ reason: "not-found" });
      await expect(
        runTestEffect(commands.snippets.deleteManaged({ workspaceId, snippetId })),
      ).rejects.toMatchObject({ reason: "not-found" });
      expect(workspaceStore.readCurrentStateRevision()).toBe(revisionAfterDelete);
    } finally {
      appLogStore.close();
      workspaceStore.close();
      appGlobalStore.close();
    }
  });

  it("keeps app and workspace rebaseline stores separate", async () => {
    const makeStore = (workspaceId: WorkspaceId) => {
      let idSequence = 0;
      return createStructuredSessionStateStore({
        databasePath: ":memory:",
        digest: testDigest,
        idFactory: (prefix) => `${prefix}-${workspaceId}-${++idSequence}`,
        now: () => "2026-06-21T12:00:00.000Z",
        workspace: {
          id: workspaceId,
          label: workspaceId,
          cwd: `/tmp/${workspaceId}` as typeof AbsolutePath.Type,
          artifactDir: `/tmp/${workspaceId}-artifacts` as typeof AbsolutePath.Type,
        },
      });
    };
    const appGlobalStore = makeStore("workspace_rebaseline_app_global" as WorkspaceId);
    const workspaceId = "workspace_rebaseline_routed" as WorkspaceId;
    const workspaceStore = makeStore(workspaceId);
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-06-21T12:00:00.000Z",
    });

    try {
      appGlobalStore.updateAppPreferences({ appearance: "dark" });
      workspaceStore.updateAppPreferences({ appearance: "light" });
      appGlobalStore.setRequestInputVariant({ mode: "blocking" });
      appGlobalStore.setRequestInputBlockingTimeout({
        enabled: false,
        durationMs: 420000 as PositiveDurationMs,
      });
      workspaceStore.setRequestInputBlockingTimeout({
        enabled: true,
        durationMs: 1000 as PositiveDurationMs,
      });
      const snippet = workspaceStore.createManagedSnippet({
        workspaceId,
        title: "Workspace-only snippet",
        body: "Workspace body",
        metadata: { description: null, argumentHint: null },
        enabled: true,
      });
      const promptHistorySurface = workspaceStore.createOrchestratorSurface(
        orchestratorStateInput(workspaceId, "Prompt history rebaseline"),
      );
      const promptHistorySubmission = workspaceStore.acceptSubmittedSurfaceMessage({
        target: {
          workspaceSessionId: promptHistorySurface.workspaceSessionId,
          surface: "orchestrator",
          surfacePiSessionId: promptHistorySurface.surfacePiSessionId,
        },
        idempotencyKey: "prompt-history-rebaseline",
        promptHistoryText: "Rebaseline this prompt",
        messageJson: JSON.stringify({ text: "Rebaseline this prompt" }),
      });
      const tab = {
        workspaceTabId: "workspace-tab-rebaseline" as WorkspaceTabId,
        workspaceId,
        cwd: `/tmp/${workspaceId}` as typeof AbsolutePath.Type,
        workspaceLabel: "Rebaseline routed",
        kind: "user" as const,
        openedAt: iso("2026-06-21T12:00:00.000Z"),
        activeLayoutId: "A" as const,
      };
      appGlobalStore.setWorkspaceTabs({
        activeWorkspaceTabId: tab.workspaceTabId,
        tabs: [tab],
        knownWorkspaces: [tab],
      });
      workspaceStore.setWorkspaceTabs({
        activeWorkspaceTabId: null,
        tabs: [],
        knownWorkspaces: [],
      });
      workspaceStore.saveWorkspaceLayoutSlot({
        workspaceId,
        layoutId: "C",
        dockviewJson: null,
        panes: [
          {
            paneId: "pane-routed-layout" as WorkspacePaneId,
            target: { surface: "open-workspace" },
            localState: { scroll: null, timelineDensity: "compact" },
            fallbackChrome: null,
            placement: null,
            restore: { kind: "ready" },
          },
        ],
        compactSurfaces: [],
        focusedPaneId: "pane-routed-layout" as WorkspacePaneId,
      });

      const router = createWorkspaceStateRouter({
        appGlobalStore,
        workspaceStores: [{ store: workspaceStore }],
      });
      const readModels = stateReadModelsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
      });
      const commands = stateCommandsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
        secretStoreMutation: unavailableSecretStoreMutation,
      });
      const readWorkspaceChrome = appGlobalStore.readWorkspaceChrome.bind(appGlobalStore);
      appGlobalStore.readWorkspaceChrome = () => {
        throw new Error("workspace chrome facade selection must not pre-read");
      };
      const alreadySelected = await runTestEffect(
        commands.workspaceChrome.selectTab({ workspaceTabId: tab.workspaceTabId }),
      );
      expect(alreadySelected).toMatchObject({
        value: { receipt: { outcome: "applied" } },
        afterCommit: [],
      });
      appGlobalStore.readWorkspaceChrome = readWorkspaceChrome;
      const saved = await runTestEffect(
        commands.workspaceLayout.saveSlot({
          workspaceId,
          layoutId: "B",
          dockviewJson: null,
          panes: [],
          compactSurfaces: [],
          focusedPaneId: null,
          clientSubmission: {
            clientRequestId: "workspace-layout-routed" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        }),
      );
      const duplicateSaved = await runTestEffect(
        commands.workspaceLayout.saveSlot({
          workspaceId,
          layoutId: "B",
          dockviewJson: null,
          panes: [],
          compactSurfaces: [],
          focusedPaneId: null,
          clientSubmission: {
            clientRequestId: "workspace-layout-routed" as RuntimeClientRequestId,
            source: "test" as RuntimeClientSubmissionSource,
          },
        }),
      );
      expect(saved).toMatchObject({
        value: { receipt: { outcome: "applied" } },
        afterCommit: [
          {
            scope: "workspace",
            workspaceId,
            invalidation: { model: "workspaceLayout", ids: ["B"] },
          },
        ],
      });
      expect(duplicateSaved).toMatchObject({
        value: { receipt: { outcome: "duplicate" } },
        afterCommit: [],
      });
      expect(workspaceStore.readWorkspaceLayout(workspaceId).slots[1]?.updatedAt).not.toBe(
        "1970-01-01T00:00:00.000Z",
      );
      expect(
        appGlobalStore.readWorkspaceLayout(appGlobalStore.workspaceId).slots[1]?.updatedAt,
      ).toBe("1970-01-01T00:00:00.000Z");
      await expect(
        runTestEffect(
          commands.workspaceLayout.saveSlot({
            workspaceId: "workspace-layout-missing" as WorkspaceId,
            layoutId: "A",
            dockviewJson: null,
            panes: [],
            compactSurfaces: [],
            focusedPaneId: null,
          }),
        ),
      ).rejects.toBeInstanceOf(StateContractError);
      const workspaceBaseline = await runTestEffect(
        readModels.rebaseline({ workspaceId, reason: "renderer-startup" }),
      );
      const appPreferences = workspaceBaseline.app.find(
        (result) => result.kind === "appPreferences",
      );
      const settings = workspaceBaseline.app.find((result) => result.kind === "settings");
      const snippets = workspaceBaseline.workspaces.find((result) => result.kind === "snippets");
      const promptHistory = workspaceBaseline.workspaces.find(
        (result) => result.kind === "promptHistory",
      );
      expect(appPreferences).toMatchObject({
        kind: "appPreferences",
        value: { appearance: "dark" },
      });
      expect(snippets).toMatchObject({
        kind: "snippets",
        value: { managed: [{ id: snippet.id, title: "Workspace-only snippet" }] },
      });
      expect(promptHistory).toMatchObject({
        kind: "promptHistory",
        value: {
          workspaceId,
          entries: [
            {
              queueItemId: promptHistorySubmission.queuedMessage.id,
              text: "Rebaseline this prompt",
            },
          ],
        },
      });
      expect(settings).toMatchObject({
        kind: "settings",
        value: {
          preferences: { appearance: "dark" },
          requestInput: {
            mode: "blocking",
            blockingTimeout: { enabled: false, durationMs: 420000 },
          },
        },
      });

      const settingsRefetch = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: { scope: "app", invalidation: { model: "settings" } },
        }),
      );
      expect(settingsRefetch).toMatchObject([
        {
          kind: "settings",
          value: {
            preferences: { appearance: "dark" },
            requestInput: {
              mode: "blocking",
              blockingTimeout: { enabled: false, durationMs: 420000 },
            },
          },
        },
      ]);

      const chrome = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: { scope: "app", invalidation: { model: "workspaceChrome" } },
        }),
      );
      expect(chrome).toMatchObject([
        {
          kind: "workspaceChrome",
          value: { activeWorkspaceTabId: tab.workspaceTabId, tabs: [tab] },
        },
      ]);

      const layout = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: {
            scope: "workspace",
            workspaceId,
            invalidation: { model: "workspaceLayout", ids: ["C"] },
          },
        }),
      );
      expect(layout).toMatchObject([
        {
          kind: "workspaceLayout",
          value: {
            workspaceId,
            slots: expect.arrayContaining([
              expect.objectContaining({
                layoutId: "C",
                panes: [expect.objectContaining({ paneId: "pane-routed-layout" })],
              }),
            ]),
          },
        },
      ]);

      appGlobalStore.setWorkspaceTabs({
        activeWorkspaceTabId: null,
        tabs: [],
        knownWorkspaces: [],
      });
      const revisionAfterTabDisappeared = appGlobalStore.readCurrentStateRevision();
      await expect(
        runTestEffect(
          commands.workspaceChrome.selectLayoutSlot({
            workspaceTabId: tab.workspaceTabId,
            layoutId: "B",
          }),
        ),
      ).rejects.toMatchObject({ reason: "not-found" });
      expect(appGlobalStore.readCurrentStateRevision()).toBe(revisionAfterTabDisappeared);

      const appBaseline = await runTestEffect(readModels.rebaseline({ reason: "manual-refresh" }));
      expect(appBaseline.workspaces).toEqual([]);
      expect(appBaseline.app).toContainEqual(
        expect.objectContaining({
          kind: "appPreferences",
          value: expect.objectContaining({ appearance: "dark" }),
        }),
      );
      expect(appBaseline.app).toContainEqual(
        expect.objectContaining({
          kind: "settings",
          value: expect.objectContaining({
            requestInput: {
              mode: "blocking",
              blockingTimeout: { enabled: false, durationMs: 420000 },
            },
          }),
        }),
      );
    } finally {
      appLogStore.close();
      workspaceStore.close();
      appGlobalStore.close();
    }
  });

  it("derives surface status from the latest turn instead of historical failures", async () => {
    const workspaceId = "workspace_surface_latest_status" as WorkspaceId;
    let clock = Date.parse("2026-06-21T12:00:00.000Z");
    const store = createStructuredSessionStateStore({
      databasePath: ":memory:",
      digest: testDigest,
      idFactory: (() => {
        let sequence = 0;
        return (prefix: string) => `${prefix}-surface-status-${++sequence}`;
      })(),
      now: () => new Date(clock++).toISOString(),
      workspace: {
        id: workspaceId,
        label: workspaceId,
        cwd: "/tmp/workspace-surface-latest-status" as typeof AbsolutePath.Type,
        artifactDir: "/tmp/workspace-surface-latest-status-artifacts" as typeof AbsolutePath.Type,
      },
    });
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => new Date(clock++).toISOString(),
    });

    try {
      const surface = store.createOrchestratorSurface(
        orchestratorStateInput(workspaceId, "Status recovery"),
      );
      const failed = store.startTurn({
        sessionId: surface.workspaceSessionId,
        surfacePiSessionId: surface.surfacePiSessionId,
        requestSummary: "First attempt",
      });
      store.finishTurn({ turnId: failed.id, status: "failed" });
      const recovered = store.startTurn({
        sessionId: surface.workspaceSessionId,
        surfacePiSessionId: surface.surfacePiSessionId,
        requestSummary: "Recovered attempt",
      });
      store.finishTurn({ turnId: recovered.id, status: "completed" });
      const readModels = stateReadModelsFromRouter({
        router: createWorkspaceStateRouter({
          appGlobalStore: store,
          workspaceStores: [{ store }],
        }),
        appLogs: appLogStateFromStore(appLogStore),
      });

      const transcript = await runTestEffect(
        readModels.fetch({ kind: "surfaceTranscript", target: surface.target }),
      );
      const summary = await runTestEffect(
        readModels.fetch({ kind: "surfaceSummary", target: surface.target }),
      );
      expect(transcript).toMatchObject({
        kind: "surfaceTranscript",
        value: { surfaceStatus: "idle" },
      });
      expect(summary).toMatchObject({ kind: "surfaceSummary", value: { status: "idle" } });
    } finally {
      appLogStore.close();
      store.close();
    }
  });

  it("routes surface read models by committed target identity", async () => {
    const makeStore = (workspaceId: WorkspaceId) =>
      createStructuredSessionStateStore({
        databasePath: ":memory:",
        digest: testDigest,
        idFactory: (prefix) => `${prefix}-${workspaceId}`,
        now: () => "2026-06-21T12:00:00.000Z",
        workspace: {
          id: workspaceId,
          label: workspaceId,
          cwd: `/tmp/${workspaceId}` as typeof AbsolutePath.Type,
          artifactDir: `/tmp/${workspaceId}-artifacts` as typeof AbsolutePath.Type,
        },
      });
    const appGlobalStore = makeStore("workspace_surface_app_global" as WorkspaceId);
    const workspaceId = "workspace_surface_routed" as WorkspaceId;
    const workspaceStore = makeStore(workspaceId);
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-06-21T12:00:00.000Z",
    });

    try {
      const surface = workspaceStore.createOrchestratorSurface(
        orchestratorStateInput(workspaceId, "Routed surface"),
      );
      const router = createWorkspaceStateRouter({
        appGlobalStore,
        workspaceStores: [],
      });
      const readModels = stateReadModelsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
      });
      router.registerWorkspaceState({ store: workspaceStore });

      await expect(
        Promise.all(
          (
            [
              "surfaceTranscript",
              "surfaceSummary",
              "surfaceComposer",
              "surfaceQueuedMessages",
            ] as const
          ).map((kind) => runTestEffect(readModels.fetch({ kind, target: surface.target }))),
        ),
      ).resolves.toMatchObject([
        { kind: "surfaceTranscript", value: { target: surface.target } },
        { kind: "surfaceSummary", value: { target: surface.target, title: "Routed surface" } },
        { kind: "surfaceComposer", value: { target: surface.target } },
        { kind: "surfaceQueuedMessages", value: { target: surface.target } },
      ]);
    } finally {
      appLogStore.close();
      workspaceStore.close();
      appGlobalStore.close();
    }
  });

  it("routes inspector reads by explicit workspace identity", async () => {
    const makeStore = (workspaceId: WorkspaceId) => {
      let nextId = 0;
      return createStructuredSessionStateStore({
        databasePath: ":memory:",
        digest: testDigest,
        idFactory: (prefix) => `${prefix}-${workspaceId}-${++nextId}`,
        now: () => "2026-06-21T12:00:00.000Z",
        workspace: {
          id: workspaceId,
          label: workspaceId,
          cwd: `/tmp/${workspaceId}` as typeof AbsolutePath.Type,
          artifactDir: `/tmp/${workspaceId}-artifacts` as typeof AbsolutePath.Type,
        },
      });
    };
    const appGlobalStore = makeStore("workspace_inspector_app_global" as WorkspaceId);
    const workspaceId = "workspace_inspector_routed" as WorkspaceId;
    const workspaceStore = makeStore(workspaceId);
    const appLogStore = createAppLogStore({
      digest: testDigest,
      now: () => "2026-06-21T12:00:00.000Z",
    });

    try {
      const surface = workspaceStore.createOrchestratorSurface(
        orchestratorStateInput(workspaceId, "Routed inspector"),
      );
      const turn = workspaceStore.startTurn({
        sessionId: surface.workspaceSessionId,
        surfacePiSessionId: surface.surfacePiSessionId,
        requestSummary: "Inspect routing",
      });
      const command = workspaceStore.createCommand({
        turnId: turn.id,
        surfacePiSessionId: surface.surfacePiSessionId,
        toolName: "exec_command",
        executor: "orchestrator",
        visibility: "summary",
        title: "Inspect routing",
        summary: "Inspect routing",
      });
      const childCommand = workspaceStore.createCommand({
        turnId: turn.id,
        surfacePiSessionId: surface.surfacePiSessionId,
        parentCommandId: command.id,
        toolName: "read",
        executor: "execute_typescript",
        visibility: "trace",
        title: "Inspect routed child",
        summary: "Inspect routed child",
      });
      const handlerThread = workspaceStore.createThread({
        turnId: turn.id,
        surfacePiSessionId: "surface-routed-handler",
        title: "Routed handler",
        objective: "Prove handler inspector routing.",
      });
      const handlerTurn = workspaceStore.startTurn({
        sessionId: surface.workspaceSessionId,
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        threadId: handlerThread.id,
        requestSummary: "Run routed workflow",
      });
      const workflowCommand = workspaceStore.createCommand({
        turnId: handlerTurn.id,
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        threadId: handlerThread.id,
        toolName: "exec_command",
        executor: "handler",
        visibility: "surface",
        title: "Run routed workflow",
        summary: "Run routed workflow",
      });
      const workflowRun = workspaceStore.recordWorkflow({
        threadId: handlerThread.id,
        commandId: workflowCommand.id,
        smithersRunId: "smithers-routed-inspector",
        workflowName: "routed_inspector",
        workflowSource: "saved",
        status: "running",
        summary: "Routed workflow is running.",
      });
      const workflowTaskAttempt = workspaceStore.upsertWorkflowTaskAttempt({
        workflowRunId: workflowRun.id,
        smithersRunId: workflowRun.smithersRunId,
        nodeId: "inspect",
        iteration: 0,
        attempt: 1,
        surfacePiSessionId: "surface-routed-workflow-task",
        title: "Routed workflow task",
        summary: "Inspect routed state.",
        kind: "agent",
        status: "running",
        smithersState: "running",
      });
      const readModels = stateReadModelsFromRouter({
        router: createWorkspaceStateRouter({
          appGlobalStore,
          workspaceStores: [{ store: workspaceStore }],
        }),
        appLogs: appLogStateFromStore(appLogStore),
      });

      const inspector = await runTestEffect(
        readModels.fetch({
          kind: "commandInspector",
          workspaceId,
          commandId: childCommand.id as CommandId,
        }),
      );
      const selectorInspector = buildStructuredCommandInspector(
        workspaceStore.getSessionState(surface.workspaceSessionId),
        childCommand.id,
      );

      expect(inspector).toEqual({
        kind: "commandInspector",
        value: selectorInspector
          ? {
              ...selectorInspector,
              target: surface.target,
              acceptedArguments: null,
            }
          : null,
      });

      await expect(
        runTestEffect(
          readModels.fetch({
            kind: "handlerInspector",
            workspaceId,
            threadId: handlerThread.id as ThreadId,
          }),
        ),
      ).resolves.toMatchObject({
        kind: "handlerInspector",
        value: { threadId: handlerThread.id, title: "Routed handler" },
      });
      await expect(
        runTestEffect(
          readModels.fetch({
            kind: "workflowTaskAttemptInspector",
            workspaceId,
            workflowTaskAttemptId: workflowTaskAttempt.id as WorkflowTaskAttemptId,
          }),
        ),
      ).resolves.toMatchObject({
        kind: "workflowTaskAttemptInspector",
        value: {
          workflowTaskAttemptId: workflowTaskAttempt.id,
          title: "Routed workflow task",
        },
      });
    } finally {
      appLogStore.close();
      workspaceStore.close();
      appGlobalStore.close();
    }
  });
});
