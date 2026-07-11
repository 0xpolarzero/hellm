import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
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
  StateCommandPostCommitNotificationPort,
  StateContractError,
} from "@svvy/core";
import type {
  AppLogEntryId,
  CommandId,
  AgentProfileId,
  ExtensionId,
  ExtensionEnvName,
  ExternalInstructionsSettings,
  GeneratedPackageBuildId,
  ModelId,
  RuntimeClientRequestId,
  RuntimeClientSubmissionSource,
  RuntimeOwnerId,
  ProviderId,
  SnippetId,
  StateCommandPostCommitNotificationInput,
  StateRevision,
  ThreadId,
  WorkflowTaskAttemptId,
  WorkspaceId,
  WorkspacePaneId,
  WorkspaceTabId,
} from "@svvy/core";
import {
  StateFacadeError,
  StateReadModels,
  createStateAppLogsFacade,
  createStateCommandsFacade,
  createStateFacade,
  layer,
  stateCommandsFromRouter,
  stateReadModelsFromRouter,
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
const stateLayer = () =>
  layer({ config: stateLayerConfig(), digest: testDigest }).pipe(
    Layer.provide(testPlatformLayer()),
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
      }).pipe(Layer.provide(testPlatformLayer())),
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
    const published: StateCommandPostCommitNotificationInput[] = [];
    const managedRuntime = ManagedRuntime.make(stateLayerWithNotifications(published));

    try {
      const commands = createStateCommandsFacade(managedRuntime);
      const tab = {
        workspaceTabId: "workspace-tab-command-facade" as WorkspaceTabId,
        workspaceId,
        cwd: "/tmp/svvy-state-command-facade" as typeof AbsolutePath.Type,
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
              tabs: [tab],
              knownWorkspaces: [tab],
              clientSubmission: {
                clientRequestId: "workspace-chrome-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [
            { scope: "workspace", workspaceId, invalidation: { model: "workspaceChromeLayout" } },
          ],
        },
        {
          operation: "stateCommands.workspaceLayout.saveSnapshot",
          clientRequestId: "workspace-layout-command",
          run: () =>
            commands.workspaceLayout.saveSnapshot({
              workspaceId,
              layoutId: "A",
              snapshotJson: { dockview: true },
              focusedPaneId: "pane-command-facade" as WorkspacePaneId,
              panelMetadata: [
                {
                  paneId: "pane-command-facade" as WorkspacePaneId,
                  kind: "agents",
                  localStateJson: { selected: "profile-default" },
                },
              ],
              clientSubmission: {
                clientRequestId: "workspace-layout-command" as RuntimeClientRequestId,
                source: "test" as RuntimeClientSubmissionSource,
              },
            }),
          descriptors: [
            { scope: "workspace", workspaceId, invalidation: { model: "workspaceChromeLayout" } },
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
        value: { preferences: appPreferences.value },
      });
      expect(baseline.app.map((readModel) => readModel.kind)).toEqual([
        "appLogSummary",
        "appPreferences",
        "settings",
        "providerAuth",
        "agents",
        "extensions",
        "workflowsGenerated",
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
        { kind: "settings", value: { preferences: appPreferences.value } },
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

describe("State read-model kind expansion", () => {
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
      const created = store.createOrchestratorSurface({
        workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        title: "Expanded read models",
      });
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
      const handlerThread = store.createThread({
        turnId: turn.id,
        surfacePiSessionId: "handler-surface-state-facade" as string,
        title: "Review docs",
        objective: "Inspect state facade read models.",
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        agentProfileJson: JSON.stringify({
          profileId: "handler-profile-state-facade",
          name: "Handler profile",
          providerId: "openai",
          modelId: "gpt-5",
        }),
        generatedAgentContextFingerprint: "handler-context-fingerprint",
      });
      store.upsertGeneratedAgentContextBinding({
        surfacePiSessionId: handlerThread.surfacePiSessionId,
        ownerKind: "thread",
        ownerId: handlerThread.id,
        actorKind: "handler",
        aggregateCacheKey: "handler-context-cache",
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
          aggregateCacheKey: "workflow-task-context-cache",
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
        openedAt: iso("2026-06-21T12:00:00.000Z"),
        activeLayoutId: "B" as const,
      };
      store.setWorkspaceTabs({
        activeWorkspaceTabId: fixtureTab.workspaceTabId,
        tabs: [fixtureTab],
        knownWorkspaces: [fixtureTab],
      });
      store.saveWorkspaceLayoutSnapshot({
        workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        layoutId: "B",
        snapshotJson: { dockview: { activeGroup: "primary" } },
        focusedPaneId: "pane-read-model-fixture" as WorkspacePaneId,
        panelMetadata: [
          {
            paneId: "pane-read-model-fixture" as WorkspacePaneId,
            kind: "surface",
            surfacePiSessionId: created.surfacePiSessionId,
            localStateJson: { selectedTab: "transcript" },
          },
        ],
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
      store.finishCommand({
        commandId: command.id,
        status: "succeeded",
        summary: "Command finished",
      });
      const requestInput = store.createRequestUserInputRequest({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: created.surfacePiSessionId,
        turnId: turn.id,
        commandId: command.id,
        toolItemId: "tool_request_input_fixture",
        variant: "blocking",
        timeout: { enabled: true, durationMs: 300_000 },
        questions: [
          {
            title: "Pick path",
            question: "Which path?",
            defaultAnswer: { kind: "custom", text: "default path" },
          },
        ],
      });
      const approval = store.createRuntimeApprovalRequest({
        sessionId: created.workspaceSessionId,
        surfacePiSessionId: created.surfacePiSessionId,
        turnId: turn.id,
        commandId: command.id,
        toolCallId: "tool_approval_fixture",
        toolName: "exec_command",
        approvalMode: "user",
        cwd: "/tmp/svvy-state-facade-read-models",
        command: "printf ok",
        commandFamily: "shell",
      });

      const router = createWorkspaceStateRouter({
        appGlobalStore: store,
        workspaceStores: [{ store }],
      });
      const appLogStore = createAppLogStore({
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
        value: { activeSessions: [{ title: "Expanded read models" }] },
      });

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
          messages: [{ role: "user", turnId: turn.id, text: "Run fixture command" }],
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
      expect(commandInspector).toMatchObject({
        kind: "commandInspector",
        value: {
          commandId: selectorInspector?.commandId,
          status: "succeeded",
          toolName: "exec_command",
          summary: "Command finished",
          output: [{ stream: "stdout", text: "ok\n", sequence: 0 }],
          childCommandIds: [],
          artifactIds: [],
        },
      });

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
      expect(agents.value.profiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ actor: "orchestrator", profileId: created.workspaceSessionId }),
          expect.objectContaining({ actor: "handler", profileId: "threadHandler" }),
          expect.objectContaining({ actor: "workflow-task", profileId: "workflow-reviewer" }),
        ]),
      );
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

      const extensions = await runTestEffect(readModels.fetch({ kind: "extensions" }));
      expect(extensions).toMatchObject({
        kind: "extensions",
        value: {
          records: [
            {
              extensionId: "shell",
              readiness: "ready",
              loadedByProfileIds: ["threadHandler"],
            },
            {
              extensionId: "smithers",
              readiness: "ready",
              availableByProfileIds: ["threadHandler"],
            },
          ],
        },
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
          exports: [],
        },
      });

      const handlerInspector = await runTestEffect(
        readModels.fetch({
          kind: "handlerInspector",
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

      const workspaceChromeLayout = await runTestEffect(
        readModels.fetch({
          kind: "workspaceChromeLayout",
          workspaceId: "workspace_state_facade_read_models" as WorkspaceId,
        }),
      );
      expect(workspaceChromeLayout).toMatchObject({
        kind: "workspaceChromeLayout",
        value: {
          activeWorkspaceTabId: "workspace-tab-read-model-fixture",
          tabs: [
            {
              workspaceTabId: "workspace-tab-read-model-fixture",
              workspaceId: "workspace_state_facade_read_models",
              activeLayoutId: "B",
            },
          ],
          knownWorkspaces: [
            {
              workspaceTabId: "workspace-tab-read-model-fixture",
              workspaceId: "workspace_state_facade_read_models",
              cwd: "/tmp/svvy-state-facade-read-models",
              activeLayoutId: "B",
            },
          ],
        },
      });
      if (workspaceChromeLayout.kind !== "workspaceChromeLayout") {
        throw new Error("Expected workspaceChromeLayout read model.");
      }
      expect(workspaceChromeLayout.value.layouts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workspaceId: "workspace_state_facade_read_models",
            layoutId: "B",
            initialized: true,
            focusedPaneId: "pane-read-model-fixture",
            snapshotJson: { dockview: { activeGroup: "primary" } },
            panelMetadata: expect.arrayContaining([
              expect.objectContaining({
                paneId: "pane-read-model-fixture",
                kind: "surface",
                surfacePiSessionId: created.surfacePiSessionId,
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
            invalidation: { model: "workspaceChromeLayout" },
          },
        }),
      );
      expect(secondHalfRefetched.map((result) => result.kind)).toEqual(["workspaceChromeLayout"]);

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
        expect.arrayContaining(["agents", "extensions", "workflowsGenerated"]),
      );
      expect(baseline.workspaces.map((result) => result.kind)).toEqual(
        expect.arrayContaining(["snippets", "workspaceChromeLayout"]),
      );
    } finally {
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
    const appLogStore = createAppLogStore({ now: () => "2026-06-21T12:00:00.000Z" });

    try {
      const router = createWorkspaceStateRouter({
        appGlobalStore,
        workspaceStores: [{ store: workspaceStore }],
      });
      const commands = stateCommandsFromRouter({
        router,
        appLogs: appLogStateFromStore(appLogStore),
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
    const appGlobalStore = makeStore("workspace_rebaseline_app_global" as WorkspaceId);
    const workspaceId = "workspace_rebaseline_routed" as WorkspaceId;
    const workspaceStore = makeStore(workspaceId);
    const appLogStore = createAppLogStore({ now: () => "2026-06-21T12:00:00.000Z" });

    try {
      appGlobalStore.updateAppPreferences({ appearance: "dark" });
      workspaceStore.updateAppPreferences({ appearance: "light" });
      const snippet = workspaceStore.createManagedSnippet({
        workspaceId,
        title: "Workspace-only snippet",
        body: "Workspace body",
        metadata: { description: null, argumentHint: null },
        enabled: true,
      });
      const tab = {
        workspaceTabId: "workspace-tab-rebaseline" as WorkspaceTabId,
        workspaceId,
        cwd: `/tmp/${workspaceId}` as typeof AbsolutePath.Type,
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

      const readModels = stateReadModelsFromRouter({
        router: createWorkspaceStateRouter({
          appGlobalStore,
          workspaceStores: [{ store: workspaceStore }],
        }),
        appLogs: appLogStateFromStore(appLogStore),
      });
      const workspaceBaseline = await runTestEffect(
        readModels.rebaseline({ workspaceId, reason: "renderer-startup" }),
      );
      const appPreferences = workspaceBaseline.app.find(
        (result) => result.kind === "appPreferences",
      );
      const snippets = workspaceBaseline.workspaces.find((result) => result.kind === "snippets");
      expect(appPreferences).toMatchObject({
        kind: "appPreferences",
        value: { appearance: "dark" },
      });
      expect(snippets).toMatchObject({
        kind: "snippets",
        value: { managed: [{ id: snippet.id, title: "Workspace-only snippet" }] },
      });

      const chrome = await runTestEffect(
        readModels.refetchInvalidation({
          descriptor: {
            scope: "workspace",
            workspaceId,
            invalidation: { model: "workspaceChromeLayout" },
          },
        }),
      );
      expect(chrome).toMatchObject([
        {
          kind: "workspaceChromeLayout",
          value: { activeWorkspaceTabId: tab.workspaceTabId, tabs: [tab] },
        },
      ]);

      const appBaseline = await runTestEffect(readModels.rebaseline({ reason: "manual-refresh" }));
      expect(appBaseline.workspaces).toEqual([]);
      expect(appBaseline.app).toContainEqual(
        expect.objectContaining({
          kind: "appPreferences",
          value: expect.objectContaining({ appearance: "dark" }),
        }),
      );
    } finally {
      appLogStore.close();
      workspaceStore.close();
      appGlobalStore.close();
    }
  });

  it("routes command-inspector reads by explicit workspace identity", async () => {
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
    const appLogStore = createAppLogStore({ now: () => "2026-06-21T12:00:00.000Z" });

    try {
      const surface = workspaceStore.createOrchestratorSurface({
        workspaceId,
        title: "Routed inspector",
      });
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
          commandId: command.id as CommandId,
        }),
      );

      expect(inspector).toMatchObject({
        kind: "commandInspector",
        value: { commandId: command.id, toolName: "exec_command" },
      });
    } finally {
      appLogStore.close();
      workspaceStore.close();
      appGlobalStore.close();
    }
  });
});
