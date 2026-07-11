import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { strictBoundaryParseOptions } from "./boundary-parse-options";
import { SandboxPolicySnapshotSchema } from "./sandbox-policy-contracts";
import { WorkspaceSessionNavigationReadModelSchema } from "./session-navigation-contracts";
import {
  decodeUnknownGetSecretStatusInputExit,
  decodeUnknownListSecretStatusInputExit,
  decodeUnknownResolveSecretInvocationValueInputExit,
  encodeGetSecretStatusInputExit,
  encodeListSecretStatusInputExit,
  encodeResolveSecretInvocationValueInputExit,
  SecretStatusSnapshotSchema,
} from "./secret-store-ports";
import { GeneratedPackageBuildStatusSchema } from "./generated-package-contracts";
import type { WorkspaceId } from "./ids";
import {
  decodeUnknownExtensionDependencyApprovalIdentityExit,
  decodeUnknownReadExtensionDependencyApprovalInputExit,
  decodeUnknownReadExtensionDependencyReadinessInputExit,
  decodeUnknownReadExtensionSourceFingerprintInputExit,
  encodeExtensionDependencyApprovalIdentityExit,
  RecordExtensionDependencyApprovalInputSchema,
} from "./extension-state-ports";
import {
  EnqueueRuntimeSurfaceMessageInputSchema,
  ClearRuntimeSessionWaitInputSchema,
  CancelRuntimeRequestInputInputSchema,
  CreateOrReuseStreamingRuntimeCommandInputSchema,
  CreateRuntimeApprovalRequestInputSchema,
  CreateRuntimeCommandInputSchema,
  CreateRuntimeRequestInputInputSchema,
  DefaultOpenRuntimeRequestInputQuestionsInputSchema,
  FinishRuntimeCommandInputSchema,
  GetRuntimeRequestInputInputSchema,
  HasRuntimeCommandOutputEventInputSchema,
  InspectRuntimeArtifactInputSchema,
  ListRuntimeArtifactsInputSchema,
  ListOpenBlockingRuntimeRequestInputsInputSchema,
  MarkGeneratedPackageRefreshNeededInputSchema,
  MarkWorkspaceGeneratedPackageLinksRepairNeededInputSchema,
  MarkRuntimeArtifactMetadataDeletedInputSchema,
  RecordExtensionDependencyReadinessInputSchema,
  RecordRuntimeArtifactMetadataInputSchema,
  RecordRuntimeCommandEventInputSchema,
  RecordObservedRuntimeSourceDeletionInputSchema,
  ResolveRuntimeApprovalRequestInputSchema,
  ReadGeneratedPackageFactsInputSchema,
  ReadRuntimeSourceVersionInputSchema,
  ReconcileGeneratedPackageManifestInputSchema,
  RecordGeneratedPackageBuildInputSchema,
  RecordGeneratedPackageFailureInputSchema,
  RecordRuntimeSourceDiagnosticInputSchema,
  RecordGeneratedPackageWorkspaceLinkInputSchema,
  RuntimeCommandRecordSchema,
  RecordRuntimeCommandStdinWriteInputSchema,
  RecordRuntimeSourceDeleteInputSchema,
  RecordRuntimeSourceSaveInputSchema,
  RecordRuntimeSourceScanInputSchema,
  ReconcileDiscoveredHostSnippetsInputSchema,
  RuntimeSourceRootFingerprintFactRecordSchema,
  RuntimeApprovalRecordSchema,
  RuntimeActorExtensionBindingRecordSchema,
  RuntimePromptBindingRecordSchema,
  RuntimeArtifactMetadataRecordSchema,
  RuntimeExtensionContextChangedSurfaceSchema,
  ExtensionDependencyReadinessSchema,
  EnsureRuntimeHandlerThreadRunnableInputSchema,
  GetCurrentRuntimeThreadInputSchema,
  GetRuntimeThreadGroupInputSchema,
  ListRuntimeThreadsInputSchema,
  ReadRuntimeThreadEpisodesInputSchema,
  RuntimeExtensionUsageProfileKeySchema,
  RuntimeEpisodeRecordSchema,
  RuntimeGeneratedPackageFactRecordSchema,
  RuntimeGeneratedPackageWorkspaceLinkRecordSchema,
  ResolveRuntimePromptDefaultsInputSchema,
  ReadRuntimePromptBindingInputSchema,
  RuntimeAnswerRequestInputCommitResultSchema,
  RuntimeRecoveryStartupSnapshotSchema,
  RuntimeRecoveryWorkKindSchema,
  RuntimeRecoveryWorkRecordSchema,
  RuntimeRequestInputDetailsRecordSchema,
  RuntimeRequestInputRecordSchema,
  RuntimeRequestInputTimeoutRecordSchema,
  RuntimeSourceFactRecordSchema,
  RuntimeSourceScanFactRecordSchema,
  RuntimeThreadCurrentReadModelSchema,
  RuntimeThreadEpisodesReadModelSchema,
  RuntimeThreadGroupReadModelSchema,
  RuntimeThreadListReadModelSchema,
  ApplyRuntimeExtensionSnapshotContextImpactInputSchema,
  ClaimNextRuntimeRecoveryWorkInputSchema,
  CompleteRuntimeRecoveryWorkInputSchema,
  EnsureRuntimeRecoveryWorkInputSchema,
  FailOrRetryRuntimeRecoveryWorkInputSchema,
  NormalizeRuntimeRecoveryStateInputSchema,
  SetRuntimeApprovalSessionWaitInputSchema,
  SetRuntimeActorExtensionBindingInputSchema,
  SetRuntimeUserSessionWaitInputSchema,
  ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema,
  RuntimeSurfaceMessageRecordSchema,
  RuntimeTurnRecordSchema,
  StartRuntimeHandlerThreadsInputSchema,
  StartRuntimeHandlerThreadsResultSchema,
  StartRuntimeCommandInputSchema,
  StartRuntimeTurnInputSchema,
  SetRuntimeTurnDecisionInputSchema,
  FinishRuntimeTurnInputSchema,
  UpdateRuntimeCommandArgumentsInputSchema,
  decodeUnknownStateCommandPostCommitNotificationInputExit,
  decodeUnknownStateCommandPostCommitNotificationErrorExit,
  decodeUnknownStateCommandPostCommitNotificationResultExit,
  encodeStateCommandPostCommitNotificationInputExit,
  encodeStateCommandPostCommitNotificationErrorExit,
  encodeStateCommandPostCommitNotificationResultExit,
} from "./runtime-state-ports";

describe("@svvy/core state-backed port contracts", () => {
  it("decodes secret status snapshots without secret values", () => {
    const decoded = Schema.decodeUnknownSync(SecretStatusSnapshotSchema)({
      ref: {
        kind: "extension-env",
        extensionId: "ext_openai",
        envName: "OPENAI_API_KEY",
      },
      configured: true,
      redactedLabel: "sk-...abcd",
      revisionFingerprint: "secret_rev_01",
      updatedAt: "2026-06-21T12:34:56.789Z",
    });

    expect(decoded.ref.kind).toBe("extension-env");
    expect(decoded.ref.extensionId as string).toBe("ext_openai");
    expect(decoded.ref.envName as string).toBe("OPENAI_API_KEY");
    expect(decoded.configured).toBe(true);
    expect(decoded.redactedLabel).toBe("sk-...abcd");
    expect(decoded.revisionFingerprint).toBe("secret_rev_01");
    expect(decoded.updatedAt as string).toBe("2026-06-21T12:34:56.789Z");
  });

  it("decodes workspace session navigation read models through public schemas", () => {
    const decoded = Schema.decodeUnknownSync(WorkspaceSessionNavigationReadModelSchema)({
      pinnedSessions: [
        {
          isPinned: true,
          pinnedAt: "2026-06-30T10:00:00.000Z",
          isArchived: false,
          archivedAt: null,
          updatedAt: "2026-06-30T10:01:00.000Z",
        },
      ],
      activeSessions: [],
      sections: {
        pinned: { collapsed: false, sizePx: 240 },
        active: { collapsed: false, sizePx: 320 },
        archived: { collapsed: true, sizePx: 180 },
      },
      archived: {
        collapsed: true,
        sessions: [],
      },
    });

    expect(decoded.pinnedSessions).toHaveLength(1);
    expect(decoded.sections.archived.collapsed).toBe(true);
  });

  it("decodes secret-store inputs through extension env refs and strict list filters", () => {
    const ref = {
      kind: "extension-env",
      extensionId: "ext_web",
      envName: "TINYFISH_API_KEY",
    };
    const decodedGet = decodeUnknownGetSecretStatusInputExit(ref);
    const decodedResolve = decodeUnknownResolveSecretInvocationValueInputExit(ref);
    const decodedList = decodeUnknownListSecretStatusInputExit({
      kind: "extension-env",
      extensionId: "ext_web",
    });
    const invalidRef = decodeUnknownGetSecretStatusInputExit({
      kind: "extension-env",
      extensionId: "ext_web",
      envName: "tinyfish_api_key",
    });
    const staleKeyInput = decodeUnknownResolveSecretInvocationValueInputExit({
      key: "web.tinyfish_api_key",
    });
    const staleNamespaceFilter = decodeUnknownListSecretStatusInputExit({
      namespace: "web",
    });

    expect(Exit.isSuccess(decodedGet)).toBe(true);
    expect(Exit.isSuccess(decodedResolve)).toBe(true);
    expect(Exit.isSuccess(decodedList)).toBe(true);
    expect(Exit.isFailure(invalidRef)).toBe(true);
    expect(Exit.isFailure(staleKeyInput)).toBe(true);
    expect(Exit.isFailure(staleNamespaceFilter)).toBe(true);
    if (Exit.isSuccess(decodedGet)) {
      expect(encodeGetSecretStatusInputExit(decodedGet.value)).toEqual(decodedGet);
    }
    if (Exit.isSuccess(decodedList)) {
      expect(encodeListSecretStatusInputExit(decodedList.value)).toEqual(decodedList);
    }
    if (Exit.isSuccess(decodedResolve)) {
      expect(encodeResolveSecretInvocationValueInputExit(decodedResolve.value)).toEqual(
        decodedResolve,
      );
    }
  });

  it("decodes immutable sandbox policy snapshots", () => {
    const decoded = Schema.decodeUnknownSync(SandboxPolicySnapshotSchema)({
      snapshotId: "sandbox_snapshot_01",
      fingerprint: "sandbox_fp_01",
      resolvedAt: "2026-06-21T12:34:56.789Z",
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      surfacePiSessionId: "pi_handler_01",
      commandId: "cmd_01",
      launchKind: "direct_shell",
      cwd: "/Users/polarzero/code/projects/svvy",
      sandboxMode: "managed",
      networkPolicy: "deny",
      filesystemPolicy: {
        defaultAccess: "read",
        entries: [
          {
            path: "/Users/polarzero/code/projects/svvy",
            access: "write",
            recursive: true,
            source: "workspace",
          },
        ],
      },
      profileDigest: "profile_digest_01",
    });

    expect(decoded).toMatchObject({
      snapshotId: "sandbox_snapshot_01",
      commandId: "cmd_01",
      sandboxMode: "managed",
      networkPolicy: "deny",
    });
  });

  it("decodes app-global generated-package sandbox policy snapshots", () => {
    const decoded = Schema.decodeUnknownSync(SandboxPolicySnapshotSchema)({
      snapshotId: "sandbox_snapshot_generated_01",
      fingerprint: "sandbox_fp_generated_01",
      resolvedAt: "2026-06-21T12:34:56.789Z",
      scope: {
        kind: "app-global-generated-package",
        packageName: "@svvyx/workflows",
        originWorkspaceId: "wksp_01",
      },
      commandId: "cmd_generated_package_01",
      launchKind: "app_owned_generated_package_build",
      cwd: "/Users/polarzero/.config/svvy/generated-packages",
      sandboxMode: "managed",
      networkPolicy: "deny",
      filesystemPolicy: {
        defaultAccess: "read",
        entries: [
          {
            path: "/Users/polarzero/.config/svvy/generated-packages",
            access: "write",
            recursive: true,
            source: "generated-output",
          },
        ],
      },
    });

    expect(decoded.scope).toMatchObject({
      kind: "app-global-generated-package",
      packageName: "@svvyx/workflows",
      originWorkspaceId: "wksp_01",
    });
  });

  it("decodes runtime source state records and mutation inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeSourceFactRecordSchema)({
      scope: { kind: "app-global" },
      scopeKey: "app-global",
      sourceKind: "workflow-agent",
      sourceId: "agent_reviewer",
      path: "/Users/polarzero/.config/svvy/workflows/agents/reviewer.agent.json",
      sourceVersion: "source_version_02",
      fingerprint: "source_fingerprint_02",
      diagnostics: [
        {
          severity: "warning",
          message: "Model id is available but not default.",
          code: "model.available",
          path: "/Users/polarzero/.config/svvy/workflows/agents/reviewer.agent.json",
          line: 3,
          column: 12,
        },
      ],
      sourceCommandId: "cmd_01",
      createdAt: "2026-06-21T12:33:56.789Z",
      updatedAt: "2026-06-21T12:34:56.789Z",
      deletedAt: null,
    });
    const readInput = Schema.decodeUnknownSync(ReadRuntimeSourceVersionInputSchema)({
      scope: { kind: "app-global" },
      sourceKind: "workflow-agent",
      sourceId: "agent_reviewer",
    });
    const saveInput = Schema.decodeUnknownSync(RecordRuntimeSourceSaveInputSchema)({
      scope: { kind: "app-global" },
      sourceKind: "workflow-agent",
      sourceId: "agent_reviewer",
      path: "/Users/polarzero/.config/svvy/workflows/agents/reviewer.agent.json",
      previousSourceVersion: "source_version_01",
      sourceVersion: "source_version_02",
      fingerprint: "source_fingerprint_02",
      diagnostics: [],
      sourceCommandId: "cmd_01",
      savedAt: "2026-06-21T12:34:56.789Z",
    });
    const deleteInput = Schema.decodeUnknownSync(RecordRuntimeSourceDeleteInputSchema)({
      scope: { kind: "app-global" },
      sourceKind: "workflow-agent",
      sourceId: "agent_reviewer",
      expectedSourceVersion: "source_version_02",
      sourceCommandId: "cmd_02",
      deletedAt: "2026-06-21T12:35:56.789Z",
    });
    const scanRecord = Schema.decodeUnknownSync(RuntimeSourceScanFactRecordSchema)({
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      scopeKey: "workspace:wksp_01",
      domain: "host_snippets",
      sourceFingerprint: "snippet_fingerprint_01",
      diagnostics: [],
      lastObservedPath: null,
      lastObservationKind: "scan",
      observedAt: "2026-06-21T12:36:56.789Z",
      createdAt: "2026-06-21T12:36:56.789Z",
      updatedAt: "2026-06-21T12:36:56.789Z",
    });
    const rootFingerprintRecord = Schema.decodeUnknownSync(
      RuntimeSourceRootFingerprintFactRecordSchema,
    )({
      scope: { kind: "app-global" },
      scopeKey: "app-global",
      domain: "extensions",
      sourceRoot: "/Users/polarzero/.config/svvy/extensions/sources/user/web",
      rootFingerprint: "web_source_fingerprint_01",
      diagnostics: [],
      observedAt: "2026-06-21T12:36:56.789Z",
      createdAt: "2026-06-21T12:36:56.789Z",
      updatedAt: "2026-06-21T12:36:56.789Z",
    });
    const scanInput = Schema.decodeUnknownSync(RecordRuntimeSourceScanInputSchema)({
      scope: { kind: "app-global" },
      domain: "extensions",
      sourceFingerprint: "extensions_fingerprint_01",
      sourceRoots: [
        {
          sourceRoot: "/Users/polarzero/.config/svvy/extensions/sources/user/web",
          rootFingerprint: "web_source_fingerprint_01",
        },
      ],
      diagnostics: [],
      scannedAt: "2026-06-21T12:37:56.789Z",
    });
    const hostSnippetReconcile = Schema.decodeUnknownSync(
      ReconcileDiscoveredHostSnippetsInputSchema,
    )({
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      sourceFingerprint: "host_snippets_fingerprint_01",
      sourceRoots: [
        {
          sourceRoot: "/Users/polarzero/.claude/commands",
          rootFingerprint: "claude_commands_fingerprint_01",
        },
      ],
      observedSnippets: [
        {
          source: "claude",
          scope: "user",
          path: "/Users/polarzero/.claude/commands/review.md",
          title: "review",
          body: "Review $1",
          metadata: { description: "Review a change", argumentHint: "path" },
        },
      ],
      unreadableSnippets: [],
      unreadableRoots: [],
      diagnostics: [],
      scannedAt: "2026-06-21T12:37:57.789Z",
    });
    const deletionInput = Schema.decodeUnknownSync(RecordObservedRuntimeSourceDeletionInputSchema)({
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      domain: "external_instructions",
      path: "/Users/polarzero/code/projects/svvy/AGENTS.md",
      diagnostics: [],
      observedAt: "2026-06-21T12:38:56.789Z",
    });
    const diagnosticInput = Schema.decodeUnknownSync(RecordRuntimeSourceDiagnosticInputSchema)({
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      domain: "external_instructions",
      path: "/Users/polarzero/code/projects/svvy/CLAUDE.md",
      diagnostic: {
        severity: "error",
        message: "Instruction source is unreadable.",
        code: "external_instruction.unreadable",
      },
      observedAt: "2026-06-21T12:39:56.789Z",
    });

    expect(record.sourceVersion as string).toBe("source_version_02");
    expect(record.sourceCommandId as string).toBe("cmd_01");
    expect(record.deletedAt).toBeNull();
    expect(readInput.sourceId).toBe("agent_reviewer");
    expect(saveInput.previousSourceVersion).toBe("source_version_01");
    expect(deleteInput.expectedSourceVersion).toBe("source_version_02");
    expect(scanRecord.scope).toMatchObject({ kind: "workspace", workspaceId: "wksp_01" });
    expect(rootFingerprintRecord.sourceRoot as string).toContain("extensions/sources/user/web");
    expect(scanInput.scope).toEqual({ kind: "app-global" });
    expect(scanInput.sourceRoots?.[0]?.rootFingerprint).toBe("web_source_fingerprint_01");
    expect(hostSnippetReconcile.observedSnippets[0]?.source).toBe("claude");
    expect(deletionInput.path as string).toContain("AGENTS.md");
    expect(diagnosticInput.diagnostic.code).toBe("external_instruction.unreadable");
  });

  it("rejects invalid runtime source scan scope/domain pairs", () => {
    const scanInput = Schema.decodeUnknownExit(RecordRuntimeSourceScanInputSchema)({
      scope: { kind: "app-global" },
      domain: "host_snippets",
      sourceFingerprint: "snippet_fingerprint_01",
      diagnostics: [],
      scannedAt: "2026-06-21T12:37:56.789Z",
    });
    const deletionInput = Schema.decodeUnknownExit(RecordObservedRuntimeSourceDeletionInputSchema)({
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      domain: "extensions",
      path: "/Users/polarzero/code/projects/svvy/extensions/source.mdx",
      diagnostics: [],
      observedAt: "2026-06-21T12:38:56.789Z",
    });
    const diagnosticInput = Schema.decodeUnknownExit(RecordRuntimeSourceDiagnosticInputSchema)({
      scope: { kind: "workspace", workspaceId: "wksp_01" },
      domain: "workflows",
      diagnostic: {
        severity: "error",
        message: "Workflow source is unreadable.",
        code: "workflow.unreadable",
      },
      observedAt: "2026-06-21T12:39:56.789Z",
    });
    const scanRecord = Schema.decodeUnknownExit(RuntimeSourceScanFactRecordSchema)({
      scope: { kind: "app-global" },
      scopeKey: "app-global",
      domain: "external_instructions",
      sourceFingerprint: "external_instruction_fingerprint_01",
      diagnostics: [],
      lastObservedPath: null,
      lastObservationKind: "scan",
      observedAt: "2026-06-21T12:36:56.789Z",
      createdAt: "2026-06-21T12:36:56.789Z",
      updatedAt: "2026-06-21T12:36:56.789Z",
    });

    expect(Exit.isFailure(scanInput)).toBe(true);
    expect(Exit.isFailure(deletionInput)).toBe(true);
    expect(Exit.isFailure(diagnosticInput)).toBe(true);
    expect(Exit.isFailure(scanRecord)).toBe(true);
  });

  it("decodes workspace generated-package link-repair sandbox policy snapshots", () => {
    const decoded = Schema.decodeUnknownSync(SandboxPolicySnapshotSchema)({
      snapshotId: "sandbox_snapshot_link_repair_01",
      fingerprint: "sandbox_fp_link_repair_01",
      resolvedAt: "2026-06-21T12:34:56.789Z",
      scope: {
        kind: "workspace-generated-package-link",
        workspaceId: "wksp_01",
        packageName: "@svvyx/workflows",
      },
      commandId: "cmd_link_repair_01",
      launchKind: "workspace_generated_package_link_repair",
      cwd: "/Users/polarzero/code/projects/svvy",
      sandboxMode: "managed",
      networkPolicy: "deny",
      filesystemPolicy: {
        defaultAccess: "read",
        entries: [
          {
            path: "/Users/polarzero/code/projects/svvy/.smithers/node_modules/@svvyx/workflows",
            access: "write",
            recursive: false,
            source: "generated-output",
          },
        ],
      },
    });

    expect(decoded.scope).toMatchObject({
      kind: "workspace-generated-package-link",
      workspaceId: "wksp_01",
      packageName: "@svvyx/workflows",
    });
    expect(decoded.launchKind).toBe("workspace_generated_package_link_repair");
  });

  it("decodes runtime queue port message records", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeSurfaceMessageRecordSchema)({
      id: "queue_01",
      sessionId: "wsess_01",
      surfacePiSessionId: "pi_orch_01",
      threadId: null,
      workflowTaskAttemptId: null,
      kind: "user_message",
      idempotencyKey: "client_submit_01",
      messageJson: '{"text":"Run tests"}',
      payloadJson: null,
      status: "queued",
      priority: "interactive",
      orderingKey: "pi_orch_01",
      sequence: 1,
      position: 1,
      sourceCommandId: null,
      claimOwnerId: null,
      claimLeaseExpiresAt: null,
      leaseVersion: 0,
      attemptCount: 0,
      maxAttempts: 3,
      nextAttemptAt: null,
      lastErrorJson: null,
      createdAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:34:56.789Z",
      deliveredAt: null,
      failedAt: null,
      failureError: null,
      cancelledAt: null,
    });

    expect(decoded).toMatchObject({
      id: "queue_01",
      kind: "user_message",
      status: "queued",
      priority: "interactive",
    });
  });

  it("decodes runtime queue enqueue inputs with absent and null optional fields", () => {
    const decoded = Schema.decodeUnknownSync(EnqueueRuntimeSurfaceMessageInputSchema)({
      sessionId: "wsess_01",
      surfacePiSessionId: "pi_orch_01",
      threadId: null,
      kind: "thread_followup",
      messageJson: '{"text":"Continue"}',
      position: "front",
    });

    expect(decoded).toMatchObject({
      sessionId: "wsess_01",
      surfacePiSessionId: "pi_orch_01",
      threadId: null,
      kind: "thread_followup",
      messageJson: '{"text":"Continue"}',
      position: "front",
    });
    expect("payloadJson" in decoded).toBe(false);
  });

  it("rejects invalid runtime queue statuses", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeSurfaceMessageRecordSchema)({
        id: "queue_01",
        sessionId: "wsess_01",
        surfacePiSessionId: "pi_orch_01",
        threadId: null,
        workflowTaskAttemptId: null,
        kind: "user_message",
        idempotencyKey: "client_submit_01",
        messageJson: "{}",
        payloadJson: null,
        status: "running",
        priority: "interactive",
        orderingKey: "pi_orch_01",
        sequence: 1,
        position: 1,
        sourceCommandId: null,
        claimOwnerId: null,
        claimLeaseExpiresAt: null,
        leaseVersion: 0,
        attemptCount: 0,
        maxAttempts: 3,
        nextAttemptAt: null,
        lastErrorJson: null,
        createdAt: "2026-06-21T12:34:56.789Z",
        updatedAt: "2026-06-21T12:34:56.789Z",
        deliveredAt: null,
        failedAt: null,
        failureError: null,
        cancelledAt: null,
      }),
    ).toThrow();
  });

  it("decodes structured generated-package dependency evidence", () => {
    const decoded = Schema.decodeUnknownSync(GeneratedPackageBuildStatusSchema)({
      packageName: "@svvyx/workflows",
      action: "written",
      buildId: "gen_build_workflows_01",
      dependencies: [
        {
          specifier: "@svvy/core",
          importKind: "type-only",
          dependencyClass: "app-owned-type-contract",
          resolutionAuthority: "app-owned-type-contract",
          manifestDependency: "dev-type-dependency",
        },
        {
          specifier: "@svvyx/extensions",
          importKind: "runtime",
          dependencyClass: "generated-package",
          resolutionAuthority: "generated-package-link",
          manifestDependency: "none-generated-package-link",
          buildId: "gen_build_extensions_01",
        },
      ],
    });

    expect(decoded.dependencies?.[0]).toEqual({
      specifier: "@svvy/core",
      importKind: "type-only",
      dependencyClass: "app-owned-type-contract",
      resolutionAuthority: "app-owned-type-contract",
      manifestDependency: "dev-type-dependency",
    });
    expect(decoded.dependencies?.[1]?.dependencyClass).toBe("generated-package");
    if (decoded.dependencies?.[1]?.dependencyClass !== "generated-package") {
      throw new Error("expected generated package dependency evidence");
    }
    expect(decoded.dependencies[1].specifier).toBe("@svvyx/extensions");
    expect(decoded.dependencies[1].buildId as string).toBe("gen_build_extensions_01");
    expect(decoded.dependencies[1].resolutionAuthority).toBe("generated-package-link");
  });

  it("rejects app-owned type-contract dependency evidence outside @svvy/core", () => {
    expect(() =>
      Schema.decodeUnknownSync(GeneratedPackageBuildStatusSchema)({
        packageName: "@svvyx/workflows",
        action: "written",
        buildId: "gen_build_workflows_01",
        dependencies: [
          {
            specifier: "@svvy/other",
            importKind: "type-only",
            dependencyClass: "app-owned-type-contract",
            resolutionAuthority: "app-owned-type-contract",
            manifestDependency: "dev-type-dependency",
          },
        ],
      }),
    ).toThrow();
  });

  it("decodes runtime generated-package fact records with structured dependencies", () => {
    const decoded = Schema.decodeUnknownSync(RuntimeGeneratedPackageFactRecordSchema)({
      packageName: "@svvyx/workflows",
      status: "ready",
      buildId: "gen_build_workflows_01",
      manifestPath: "/app/generated/workflows/.svvy-generated-package.json",
      sourceFingerprint: "source-fingerprint-01",
      outputFingerprint: "output-fingerprint-01",
      generatedFileListDigest: "files-digest-01",
      dependencies: [
        {
          specifier: "@svvy/core",
          importKind: "type-only",
          dependencyClass: "app-owned-type-contract",
          resolutionAuthority: "app-owned-type-contract",
          manifestDependency: "dev-type-dependency",
        },
        {
          specifier: "@svvyx/extensions",
          importKind: "runtime",
          dependencyClass: "generated-package",
          resolutionAuthority: "generated-package-link",
          manifestDependency: "none-generated-package-link",
          buildId: "gen_build_extensions_01",
        },
      ],
      diagnostics: [],
      sourceCommandId: "cmd_generated_package_01",
      refreshNeededReason: null,
      lastRecoveryWorkId: "recovery_generated_package_01",
      createdAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:35:56.789Z",
    });

    expect(decoded.dependencies[0]?.dependencyClass).toBe("app-owned-type-contract");
    expect(decoded.dependencies[1]?.dependencyClass).toBe("generated-package");
  });

  it("rejects legacy generated-package fact dependency records", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeGeneratedPackageFactRecordSchema)({
        packageName: "@svvyx/workflows",
        status: "ready",
        buildId: "gen_build_workflows_01",
        manifestPath: "/app/generated/workflows/.svvy-generated-package.json",
        sourceFingerprint: "source-fingerprint-01",
        outputFingerprint: "output-fingerprint-01",
        generatedFileListDigest: "files-digest-01",
        dependencies: [{ name: "@svvy/core", version: "workspace" }],
        diagnostics: [],
        sourceCommandId: null,
        refreshNeededReason: null,
        lastRecoveryWorkId: null,
        createdAt: "2026-06-21T12:34:56.789Z",
        updatedAt: "2026-06-21T12:35:56.789Z",
      }),
    ).toThrow();
  });

  it("decodes extension dependency readiness records and runtime write inputs", () => {
    const readiness = Schema.decodeUnknownSync(ExtensionDependencyReadinessSchema)({
      extensionId: "ext_web",
      requirementId: "dep:tinyfish",
      status: "ready",
      detectedVersion: "1.2.3",
      expectedVersion: "1.2.3",
      diagnostics: [],
      checkedAt: "2026-06-21T12:34:56.789Z",
    });
    const input = Schema.decodeUnknownSync(RecordExtensionDependencyReadinessInputSchema)({
      readiness,
      sourceCommandId: "cmd_dependency_01",
      recordedAt: "2026-06-21T12:35:56.789Z",
    });

    expect(input.readiness.extensionId as string).toBe("ext_web");
    expect(input.readiness.requirementId).toBe("dep:tinyfish");
    expect(input.readiness.status).toBe("ready");

    expect(() =>
      Schema.decodeUnknownSync(ExtensionDependencyReadinessSchema)({
        extensionId: "ext_web",
        requirementId: "",
        status: "ready",
        detectedVersion: null,
        expectedVersion: null,
        diagnostics: [],
        checkedAt: null,
      }),
    ).toThrow();
  });

  it("decodes extension state port inputs through public schemas", () => {
    const identity = decodeUnknownExtensionDependencyApprovalIdentityExit({
      kind: "dependency",
      packageManager: "bun",
      source: "npm",
      name: "@tiny-fish/cli",
      version: "0.1.6",
      integrity: null,
      resolution: null,
    });

    expect(Exit.isSuccess(identity)).toBe(true);
    if (Exit.isSuccess(identity)) {
      expect(encodeExtensionDependencyApprovalIdentityExit(identity.value)).toEqual(identity);
      expect(
        Exit.isSuccess(
          decodeUnknownReadExtensionDependencyApprovalInputExit({
            dependency: identity.value,
          }),
        ),
      ).toBe(true);
      const recordApprovalInput = Schema.decodeUnknownSync(
        RecordExtensionDependencyApprovalInputSchema,
      )({
        dependency: identity.value,
        approvedAt: "2026-06-21T12:35:56.789Z",
        approvedBy: "user",
        sourceCommandId: "cmd_dependency_approval_01",
      });
      expect(recordApprovalInput.dependency).toEqual(identity.value);
      expect(recordApprovalInput.approvedAt as string).toBe("2026-06-21T12:35:56.789Z");
      expect(recordApprovalInput.approvedBy).toBe("user");
      expect(recordApprovalInput.sourceCommandId as string).toBe("cmd_dependency_approval_01");
    }

    const trustedIdentity = decodeUnknownExtensionDependencyApprovalIdentityExit({
      kind: "trusted_dependency",
      packageManager: "bun",
      source: "npm",
      name: "@tiny-fish/cli",
      version: "0.1.6",
      integrity: "sha512-good",
      resolution: "https://registry.npmjs.org/@tiny-fish/cli/-/cli-0.1.6.tgz",
    });

    expect(Exit.isSuccess(trustedIdentity)).toBe(true);
    if (Exit.isSuccess(trustedIdentity)) {
      expect(encodeExtensionDependencyApprovalIdentityExit(trustedIdentity.value)).toEqual(
        trustedIdentity,
      );
    }

    expect(
      Exit.isSuccess(
        decodeUnknownReadExtensionSourceFingerprintInputExit({
          sourceRoot: "/Users/polarzero/.config/svvy/extensions/sources/user/web-search",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownReadExtensionDependencyReadinessInputExit({
          extensionId: "web",
          requirementId: "cli:tinyfish",
        }),
      ),
    ).toBe(true);
    for (const invalid of [
      {
        kind: "dependency",
        packageManager: "bun",
        source: "npm",
        name: "",
        version: "0.1.6",
        integrity: null,
        resolution: null,
      },
      {
        kind: "dependency",
        packageManager: "bun",
        source: "npm",
        name: "@tiny-fish/cli",
        version: "",
        integrity: null,
        resolution: null,
      },
      {
        kind: "dependency",
        packageManager: "bun",
        source: "npm",
        name: "@tiny-fish/cli",
        version: "0.1.6",
        integrity: "",
        resolution: null,
      },
      {
        kind: "dependency",
        packageManager: "bun",
        source: "npm",
        name: "@tiny-fish/cli",
        version: "0.1.6",
        integrity: null,
        resolution: "",
      },
    ]) {
      expect(Exit.isFailure(decodeUnknownExtensionDependencyApprovalIdentityExit(invalid))).toBe(
        true,
      );
    }
    expect(
      Exit.isFailure(
        decodeUnknownExtensionDependencyApprovalIdentityExit({
          kind: "dependency",
          packageManager: "npm",
          source: "npm",
          name: "@tiny-fish/cli",
          version: "0.1.6",
          integrity: null,
          resolution: null,
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownReadExtensionDependencyReadinessInputExit({
          extensionId: "web",
          requirementId: "",
        }),
      ),
    ).toBe(true);
  });

  it("decodes runtime generated-package workspace link records and inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeGeneratedPackageWorkspaceLinkRecordSchema)({
      workspaceId: "wksp_01",
      packageName: "@svvyx/workflows",
      status: "repair-needed",
      linkPath: "/workspace/.smithers/node_modules/@svvyx/workflows",
      targetPath: "/app/generated/workflows",
      diagnostics: [],
      sourceCommandId: "cmd_generated_package_01",
      lastRecoveryWorkId: null,
      createdAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:35:56.789Z",
    });
    const input = Schema.decodeUnknownSync(RecordGeneratedPackageWorkspaceLinkInputSchema)({
      status: {
        workspaceId: "wksp_01",
        packageName: "@svvyx/workflows",
        status: "linked",
        linkPath: "/workspace/.smithers/node_modules/@svvyx/workflows",
        targetPath: "/app/generated/workflows",
      },
      sourceCommandId: "cmd_generated_package_01",
      recoveryWorkId: null,
    });

    expect(record.status).toBe("repair-needed");
    expect(input.status.packageName).toBe("@svvyx/workflows");
  });

  it("decodes runtime generated-package state-port inputs", () => {
    expect(
      Schema.decodeUnknownSync(ReadGeneratedPackageFactsInputSchema)({
        packages: ["@svvyx/extensions"],
      }).packages,
    ).toEqual(["@svvyx/extensions"]);

    expect(
      Schema.decodeUnknownSync(MarkGeneratedPackageRefreshNeededInputSchema)({
        packageName: "@svvyx/workflows",
        reason: "source-changed",
        sourceCommandId: null,
      }).reason,
    ).toBe("source-changed");
    expect(
      Schema.decodeUnknownSync(MarkWorkspaceGeneratedPackageLinksRepairNeededInputSchema)({
        workspaceId: "workspace_generated_link_repair_01",
        packages: ["@svvyx/workflows"],
        reason: "app-global-generated-package-refreshed",
        requestedAt: "2026-06-21T12:34:56.789Z",
        maxAttempts: 5,
      }).packages,
    ).toEqual(["@svvyx/workflows"]);

    expect(
      Schema.decodeUnknownSync(ReconcileGeneratedPackageManifestInputSchema)({
        fact: {
          packageName: "@svvyx/extensions",
          buildId: "gen_build_extensions_01",
          manifestPath: "/app/generated/extensions/.svvy-generated-package.json",
          sourceFingerprint: "source-fingerprint-01",
          outputFingerprint: "output-fingerprint-01",
          generatedFileListDigest: "files-digest-01",
          dependencies: [],
        },
        diagnostics: [],
        recoveryWorkId: "recovery_generated_package_01",
      }).fact.packageName,
    ).toBe("@svvyx/extensions");
  });

  it("keeps generated-package build and failure input actions disjoint", () => {
    const decodeBuildInput = Schema.decodeUnknownSync(
      RecordGeneratedPackageBuildInputSchema,
      strictBoundaryParseOptions,
    );
    const buildStatus = {
      packageName: "@svvyx/workflows",
      action: "written",
      refreshScope: "app-global-build",
      buildId: "gen_build_workflows_01",
      manifestPath: "/app/generated/workflows/.svvy-generated-package.json",
    };
    expect(
      decodeBuildInput({
        status: buildStatus,
        workflowsExports: [],
      }).status.action,
    ).toBe("written");
    expect(() =>
      decodeBuildInput({
        status: buildStatus,
      }),
    ).toThrow();
    expect(() =>
      decodeBuildInput({
        status: {
          ...buildStatus,
          packageName: "@svvyx/extensions",
        },
        workflowsExports: [],
      }),
    ).toThrow();
    expect(() =>
      decodeBuildInput({
        status: {
          packageName: "@svvyx/workflows",
          action: "written",
          buildId: "gen_build_workflows_01",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeBuildInput({
        status: {
          packageName: "@svvyx/workflows",
          action: "failed",
          diagnostics: ["build failed"],
        },
      }),
    ).toThrow();

    expect(
      Schema.decodeUnknownSync(RecordGeneratedPackageFailureInputSchema)({
        status: {
          packageName: "@svvyx/workflows",
          action: "failed",
          refreshScope: "app-global-build",
          diagnostics: ["build failed"],
        },
      }).status.action,
    ).toBe("failed");
    for (const action of ["written", "unchanged"] as const) {
      expect(() =>
        Schema.decodeUnknownSync(RecordGeneratedPackageFailureInputSchema)({
          status: {
            packageName: "@svvyx/workflows",
            action,
            buildId: "gen_build_workflows_01",
          },
        }),
      ).toThrow();
    }
  });

  it("decodes runtime turn lifecycle records and inputs", () => {
    const pendingRecord = Schema.decodeUnknownSync(RuntimeTurnRecordSchema)({
      id: "turn_01",
      sessionId: "session_01",
      surfacePiSessionId: "pi_session_01",
      threadId: null,
      requestSummary: "Implement the runtime facade",
      turnDecision: "pending",
      status: "running",
      startedAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:34:56.789Z",
      finishedAt: null,
    });
    const decidedRecord = Schema.decodeUnknownSync(RuntimeTurnRecordSchema)({
      ...pendingRecord,
      turnDecision: "exec_command",
      status: "completed",
      finishedAt: "2026-06-21T12:35:56.789Z",
    });
    const startInput = Schema.decodeUnknownSync(StartRuntimeTurnInputSchema)({
      sessionId: "session_01",
      surfacePiSessionId: "pi_session_01",
      requestSummary: "Implement the runtime facade",
    });
    const decisionInput = Schema.decodeUnknownSync(SetRuntimeTurnDecisionInputSchema)({
      turnId: "turn_01",
      decision: "exec_command",
      onlyIfPending: true,
    });
    const finishInput = Schema.decodeUnknownSync(FinishRuntimeTurnInputSchema)({
      turnId: "turn_01",
      status: "completed",
    });

    expect(pendingRecord.turnDecision).toBe("pending");
    expect(decidedRecord.turnDecision).toBe("exec_command");
    expect(startInput.threadId).toBeUndefined();
    expect(decisionInput.onlyIfPending).toBe(true);
    expect(finishInput.status).toBe("completed");
  });

  it("rejects running as a runtime turn finish status", () => {
    expect(() =>
      Schema.decodeUnknownSync(FinishRuntimeTurnInputSchema)({
        turnId: "turn_01",
        status: "running",
      }),
    ).toThrow();
  });

  it("decodes runtime command records and inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeCommandRecordSchema)({
      id: "cmd_01",
      sessionId: "session_01",
      turnId: "turn_01",
      workflowTaskAttemptId: null,
      surfacePiSessionId: "pi_session_01",
      threadId: null,
      workflowRunId: null,
      parentCommandId: null,
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "surface",
      status: "running",
      attempts: 1,
      title: "Run unit tests",
      summary: "bun test packages/core",
      arguments: { cmd: "bun test packages/core", cwd: "/workspace" },
      facts: { exitCode: 0, commandFamily: "bun" },
      error: null,
      startedAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:35:56.789Z",
      finishedAt: null,
    });
    const createInput = Schema.decodeUnknownSync(CreateRuntimeCommandInputSchema)({
      turnId: "turn_01",
      toolName: "exec_command",
      executor: "orchestrator",
      visibility: "surface",
      title: "Run unit tests",
      summary: "bun test packages/core",
      arguments: { cmd: "bun test packages/core" },
      status: "requested",
    });
    const streamingInput = Schema.decodeUnknownSync(
      CreateOrReuseStreamingRuntimeCommandInputSchema,
    )({
      toolCallId: "tool_01",
      toolName: "exec_command",
      executor: "handler",
      visibility: "trace",
      title: "Tail output",
      summary: "stdout stream",
      facts: { stream: "stdout" },
    });
    const updateArgumentsInput = Schema.decodeUnknownSync(UpdateRuntimeCommandArgumentsInputSchema)(
      {
        commandId: "cmd_01",
        arguments: { cmd: "bun run typecheck", env: { CI: true } },
      },
    );
    const startInput = Schema.decodeUnknownSync(StartRuntimeCommandInputSchema)({
      commandId: "cmd_01",
    });
    const finishInput = Schema.decodeUnknownSync(FinishRuntimeCommandInputSchema)({
      commandId: "cmd_01",
      status: "succeeded",
      visibility: "summary",
      summary: "Unit tests passed.",
      facts: { exitCode: 0 },
      error: null,
    });
    const eventInput = Schema.decodeUnknownSync(RecordRuntimeCommandEventInputSchema)({
      sessionId: "session_01",
      commandId: "cmd_01",
      kind: "command.output",
      data: { stream: "stdout", text: "ok" },
    });
    const stdinInput = Schema.decodeUnknownSync(RecordRuntimeCommandStdinWriteInputSchema)({
      sessionId: "session_01",
      commandId: "cmd_01",
      text: "hello\n",
      acceptedBytes: 6,
    });
    const outputCheckInput = Schema.decodeUnknownSync(HasRuntimeCommandOutputEventInputSchema)({
      sessionId: "session_01",
      commandId: "cmd_01",
      stream: "stdout",
      source: "live-stream",
    });

    expect(record.status).toBe("running");
    expect(createInput.status).toBe("requested");
    expect(streamingInput.toolCallId).toBe("tool_01");
    expect(updateArgumentsInput.commandId).toBe("cmd_01");
    expect(startInput.commandId).toBe("cmd_01");
    expect(finishInput.status).toBe("succeeded");
    expect(eventInput.kind).toBe("command.output");
    expect(stdinInput.acceptedBytes).toBe(6);
    expect(outputCheckInput.stream).toBe("stdout");
  });

  it("rejects invalid runtime command finish statuses, output streams, and stdin byte counts", () => {
    expect(() =>
      Schema.decodeUnknownSync(FinishRuntimeCommandInputSchema)({
        commandId: "cmd_01",
        status: "running",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(HasRuntimeCommandOutputEventInputSchema)({
        sessionId: "session_01",
        commandId: "cmd_01",
        stream: "combined",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RecordRuntimeCommandEventInputSchema)({
        sessionId: "session_01",
        commandId: "cmd_01",
        kind: "command.output",
        data: { stream: "combined", text: "ok" },
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RecordRuntimeCommandStdinWriteInputSchema)({
        sessionId: "session_01",
        commandId: "cmd_01",
        text: "hello\n",
        acceptedBytes: 1.5,
      }),
    ).toThrow();
  });

  it("decodes runtime request-input records and inputs", () => {
    const createInput = Schema.decodeUnknownSync(CreateRuntimeRequestInputInputSchema)({
      target: {
        workspaceSessionId: "session_01",
        surface: "orchestrator",
        surfacePiSessionId: "pi_session_01",
      },
      turnId: "turn_01",
      toolItemId: "tool_01",
      sourceCommandId: "cmd_01",
      mode: "blocking",
      timeout: { enabled: true, durationMs: 60000 },
      questions: [
        {
          title: "Select scope",
          question: "Which package should be updated first?",
          defaultAnswer: { kind: "option", label: "Core", text: "@svvy/core" },
          choices: [
            {
              label: "Core",
              description: "Start with contract schemas.",
              recommended: true,
            },
            {
              label: "Runtime",
              description: "Start with runtime orchestration.",
              recommended: false,
            },
          ],
        },
      ],
    });
    const record = Schema.decodeUnknownSync(RuntimeRequestInputRecordSchema)({
      requestId: "request_input_01",
      sessionId: "session_01",
      surfacePiSessionId: "pi_session_01",
      threadId: null,
      turnId: "turn_01",
      commandId: "cmd_01",
      variant: "blocking",
      status: "open",
      questionCount: 1,
    });
    const details = Schema.decodeUnknownSync(RuntimeRequestInputDetailsRecordSchema)({
      ...record,
      toolItemId: "tool_01",
      createdAt: "2026-06-21T12:34:56.789Z",
      completedAt: null,
      timeout: {
        enabled: true,
        durationMs: 60000,
        startedAt: "2026-06-21T12:34:56.789Z",
        pausedAt: null,
        remainingMsWhenPaused: null,
        expiresAt: "2026-06-21T12:35:56.789Z",
      },
      questions: [
        {
          questionId: "request_question_01",
          requestId: "request_input_01",
          ordinal: 0,
          title: "Select scope",
          question: "Which package should be updated first?",
          defaultAnswer: { kind: "option", label: "Core", text: "@svvy/core" },
          choices: [
            {
              optionId: "request_option_01",
              ordinal: 0,
              label: "Core",
              description: "Start with contract schemas.",
              recommended: true,
            },
          ],
          status: "open",
        },
      ],
      answers: [
        {
          answerId: "request_answer_01",
          requestId: "request_input_01",
          questionId: "request_question_01",
          answer: { kind: "custom", text: "@svvy/runtime" },
          answeredBy: "user",
          delivery: "enqueue-and-run",
          queuedItemId: "queue_01",
          createdAt: "2026-06-21T12:35:00.000Z",
        },
      ],
    });
    const getInput = Schema.decodeUnknownSync(GetRuntimeRequestInputInputSchema)({
      requestId: "request_input_01",
    });
    const listInput = Schema.decodeUnknownSync(ListOpenBlockingRuntimeRequestInputsInputSchema)({
      workspaceSessionId: "session_01",
      surfacePiSessionId: null,
    });
    const defaultInput = Schema.decodeUnknownSync(
      DefaultOpenRuntimeRequestInputQuestionsInputSchema,
    )({
      requestId: "request_input_01",
      answeredBy: "timeout_default",
    });
    const cancelInput = Schema.decodeUnknownSync(CancelRuntimeRequestInputInputSchema)({
      requestId: "request_input_01",
    });

    expect(createInput.mode).toBe("blocking");
    expect(record.status).toBe("open");
    expect(details.questions[0]?.choices[0]?.optionId as string).toBe("request_option_01");
    expect(details.answers[0]?.answeredBy).toBe("user");
    expect(getInput.requestId as string).toBe("request_input_01");
    expect(listInput.surfacePiSessionId).toBe(null);
    expect(defaultInput.answeredBy).toBe("timeout_default");
    expect(cancelInput.requestId as string).toBe("request_input_01");
    expect(
      Schema.decodeUnknownSync(RuntimeAnswerRequestInputCommitResultSchema)({
        answer: {
          requestId: "request_input_01",
          questionId: "request_question_01",
          status: "recorded",
          delivery: { kind: "blocking-resolved", queuedItemId: null },
        },
        target: {
          workspaceSessionId: "session_01",
          surface: "orchestrator",
          surfacePiSessionId: "pi_session_01",
        },
      }).answer.delivery.kind,
    ).toBe("blocking-resolved");
  });

  it("decodes runtime prompt defaults inputs", () => {
    const decoded = Schema.decodeUnknownSync(ResolveRuntimePromptDefaultsInputSchema)({
      target: {
        workspaceSessionId: "session_01",
        surface: "handler",
        threadId: "thread_01",
        surfacePiSessionId: "pi_session_01",
      },
    });

    expect(decoded.target.surface).toBe("handler");
  });

  it("decodes runtime prompt binding reads and records", () => {
    const input = Schema.decodeUnknownSync(ReadRuntimePromptBindingInputSchema)({
      target: {
        workspaceSessionId: "session_01",
        surface: "handler",
        threadId: "thread_01",
        surfacePiSessionId: "pi_session_01",
      },
    });
    const record = Schema.decodeUnknownSync(RuntimePromptBindingRecordSchema)({
      target: input.target,
      generatedAgentContextBindingId: "generated-context-binding_01",
      generatedAgentContextFingerprint: "fingerprint_01",
      generatedAgentContextRevision: 3,
      systemPrompt: "Use the bound system prompt.",
      loadedExtensionIds: ["base-common", "thread-handling"],
      availableExtensionIds: ["smithers"],
      externalSourceHashes: ["agents-md:sha256"],
      updateExtensionContextBeforeNextTurn: true,
    });

    expect(record.target.surface).toBe("handler");
    expect(record.generatedAgentContextRevision).toBe(3);
    expect(record.systemPrompt).toBe("Use the bound system prompt.");
  });

  it("rejects request-input timeout records and inputs with invalid millisecond durations", () => {
    for (const durationMs of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() =>
        Schema.decodeUnknownSync(CreateRuntimeRequestInputInputSchema)({
          target: {
            workspaceSessionId: "session_01",
            surface: "orchestrator",
            surfacePiSessionId: "pi_session_01",
          },
          turnId: "turn_01",
          toolItemId: "tool_01",
          sourceCommandId: "cmd_01",
          mode: "blocking",
          timeout: { enabled: true, durationMs },
          questions: [
            {
              title: "Select scope",
              question: "Which package should be updated first?",
              defaultAnswer: { kind: "custom", text: "@svvy/core" },
            },
          ],
        }),
      ).toThrow();

      expect(() =>
        Schema.decodeUnknownSync(RuntimeRequestInputTimeoutRecordSchema)({
          enabled: true,
          durationMs,
          startedAt: "2026-06-21T12:34:56.789Z",
          pausedAt: null,
          remainingMsWhenPaused: null,
          expiresAt: "2026-06-21T12:35:56.789Z",
        }),
      ).toThrow();
    }

    expect(() =>
      Schema.decodeUnknownSync(RuntimeRequestInputTimeoutRecordSchema)({
        enabled: true,
        durationMs: 60000,
        startedAt: "2026-06-21T12:34:56.789Z",
        pausedAt: "2026-06-21T12:35:00.000Z",
        remainingMsWhenPaused: -1,
        expiresAt: null,
      }),
    ).toThrow();
  });

  it("decodes and encodes state command post-commit notification errors", () => {
    const decoded = decodeUnknownStateCommandPostCommitNotificationErrorExit({
      type: "state-command-post-commit-notification-error",
      operation: "stateCommands.appLogs.markRead",
      reason: "publication-failed",
      receipt: {
        clientRequestId: "client_req_01",
        outcome: "applied",
        committedAt: "2026-06-21T12:34:56.789Z",
        stateRevision: 42,
      },
      message: "Runtime event bus rejected committed descriptors.",
      affectedReadModels: [
        { scope: "workspace", workspaceId: "workspace_01", invalidation: { model: "appLogs" } },
      ],
    });

    expect(Exit.isSuccess(decoded)).toBe(true);
    if (Exit.isSuccess(decoded)) {
      expect(encodeStateCommandPostCommitNotificationErrorExit(decoded.value)).toEqual(decoded);
    }

    expect(
      Exit.isFailure(
        decodeUnknownStateCommandPostCommitNotificationErrorExit({
          type: "state-command-post-commit-notification-error",
          operation: "stateCommands.appLogs.markRead",
          reason: "state-conflict",
          receipt: {
            clientRequestId: "client_req_01",
            outcome: "applied",
            committedAt: "2026-06-21T12:34:56.789Z",
            stateRevision: 42,
          },
          message: "Wrong error channel.",
        }),
      ),
    ).toBe(true);
  });

  it("decodes and encodes state command post-commit notification inputs and results", () => {
    const input = {
      operation: "stateCommands.appLogs.markRead",
      receipt: {
        clientRequestId: "client_req_01",
        outcome: "applied",
        committedAt: "2026-06-21T12:34:56.789Z",
        stateRevision: 42,
      },
      descriptors: [
        { scope: "workspace", workspaceId: "workspace_01", invalidation: { model: "appLogs" } },
      ],
      clientSubmission: {
        clientRequestId: "client_req_01",
        submittedAt: "2026-06-21T12:34:55.789Z",
      },
    };
    const result = {
      receipt: input.receipt,
      acceptedDescriptorCount: 1,
      rebaselineRequired: false,
    };

    const decodedInput = decodeUnknownStateCommandPostCommitNotificationInputExit(input);
    const decodedResult = decodeUnknownStateCommandPostCommitNotificationResultExit(result);

    expect(Exit.isSuccess(decodedInput)).toBe(true);
    expect(Exit.isSuccess(decodedResult)).toBe(true);
    if (Exit.isSuccess(decodedInput)) {
      expect(encodeStateCommandPostCommitNotificationInputExit(decodedInput.value)).toEqual(
        decodedInput,
      );
    }
    if (Exit.isSuccess(decodedResult)) {
      expect(encodeStateCommandPostCommitNotificationResultExit(decodedResult.value)).toEqual(
        decodedResult,
      );
    }
  });

  it("rejects non-timeout defaults as default-open request-input answers", () => {
    expect(() =>
      Schema.decodeUnknownSync(DefaultOpenRuntimeRequestInputQuestionsInputSchema)({
        requestId: "request_input_01",
        answeredBy: "default",
      }),
    ).toThrow();
  });

  it("decodes runtime actor extension binding and context-impact DTOs", () => {
    const target = {
      workspaceSessionId: "session_01",
      surface: "handler",
      surfacePiSessionId: "pi_handler_01",
      threadId: "thread_01",
    };
    const binding = Schema.decodeUnknownSync(RuntimeActorExtensionBindingRecordSchema)({
      target,
      loadedExtensionIds: ["extension_loaded_01"],
      availableExtensionIds: ["extension_loaded_01", "extension_available_01"],
      generatedAgentContextFingerprint: "context-fingerprint-01",
      updateExtensionContextBeforeNextTurn: true,
    });
    const setInput = Schema.decodeUnknownSync(SetRuntimeActorExtensionBindingInputSchema)({
      target,
      loadedExtensionIds: ["extension_loaded_01"],
      availableExtensionIds: ["extension_available_01"],
      reason: "source-refresh",
      sourceCommandId: "cmd_01",
    });
    const surface = Schema.decodeUnknownSync(RuntimeExtensionContextChangedSurfaceSchema)({
      surfacePiSessionId: "pi_handler_01",
      kind: "extension_context_changed",
      label: "Extensions changed",
      reason: "snapshot_loaded",
    });
    const usageLookup = Schema.decodeUnknownSync(
      ListRuntimeExtensionUsageContextAffectedSurfacesInputSchema,
    )({
      agentProfile: "threadHandler",
      profileId: "agent_profile_01",
    });
    const snapshotImpact = Schema.decodeUnknownSync(
      ApplyRuntimeExtensionSnapshotContextImpactInputSchema,
    )({
      affectedExtensionIds: ["extension_loaded_01"],
      affectedUsageProfiles: ["orchestrator:default", "handler:threadHandler"],
      removedUserExtensionIds: ["extension_removed_01"],
    });

    expect(binding.target.surface).toBe("handler");
    expect(setInput.reason).toBe("source-refresh");
    expect(surface.reason).toBe("snapshot_loaded");
    expect(usageLookup.profileId as string).toBe("agent_profile_01");
    expect(snapshotImpact.affectedUsageProfiles).toEqual([
      "orchestrator:default",
      "handler:threadHandler",
    ]);
  });

  it("rejects empty orchestrator extension usage profile keys", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeExtensionUsageProfileKeySchema)("orchestrator:"),
    ).toThrow();
  });

  it("decodes runtime recovery records, startup snapshots, and inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeRecoveryWorkRecordSchema)({
      id: "recovery_01",
      scope: { kind: "workspace", workspaceId: "workspace_01" },
      kind: "queue_delivery",
      status: "pending",
      ownerScope: {
        kind: "surface",
        workspaceSessionId: "session_01",
        surfacePiSessionId: "pi_session_01",
      },
      idempotencyKey: "queue_delivery:pi_session_01",
      orderingKey: "surface:pi_session_01",
      orderingSeq: 100,
      priority: 30,
      availableAt: "2026-06-21T12:34:56.789Z",
      attempts: 0,
      maxAttempts: 5,
      claimedBy: null,
      claimedAt: null,
      claimExpiresAt: null,
      leaseVersion: 0,
      payloadJson: null,
      lastError: null,
      createdAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:34:56.789Z",
      completedAt: null,
    });
    const snapshot = Schema.decodeUnknownSync(RuntimeRecoveryStartupSnapshotSchema)({
      session: {
        id: "session_01",
        orchestratorPiSessionId: "pi_session_01",
      },
      pi: { titleGenerationStatus: "running" },
      turns: [
        {
          id: "turn_01",
          status: "running",
          surfacePiSessionId: "pi_session_01",
          threadId: null,
        },
      ],
      queuedMessages: [
        {
          id: "queue_01",
          status: "dispatching",
          surfacePiSessionId: "pi_session_01",
          kind: "thread_report_notification",
          position: 1,
        },
      ],
      threads: [
        {
          id: "thread_01",
          status: "running-handler",
          surfacePiSessionId: "pi_thread_01",
          title: "Investigate",
          objective: "Investigate",
        },
      ],
    });
    const ensureInput = Schema.decodeUnknownSync(EnsureRuntimeRecoveryWorkInputSchema)({
      scope: { kind: "workspace", workspaceId: "workspace_01" },
      kind: "workspace_generated_package_link_repair",
      ownerScope: { kind: "workspace" },
      idempotencyKey: "workspace_generated_package_link_repair:workspace_01",
      orderingKey: "workspace:workspace_01",
      orderingSeq: 0,
      priority: 5,
      availableAt: "2026-06-21T12:34:56.789Z",
      maxAttempts: 5,
      payloadJson: {
        generatedPackagePath: "/tmp/generated-workflows",
        extensionsGeneratedPackagePath: null,
      },
    });
    const claimInput = Schema.decodeUnknownSync(ClaimNextRuntimeRecoveryWorkInputSchema)({
      claimedBy: "runtime_owner_01",
      scope: { kind: "app" },
      kinds: ["generated_package_refresh"],
      leaseMs: 60000,
    });
    const completeInput = Schema.decodeUnknownSync(CompleteRuntimeRecoveryWorkInputSchema)({
      id: "recovery_01",
      claimedBy: "runtime_owner_01",
      leaseVersion: 1,
    });
    const retryInput = Schema.decodeUnknownSync(FailOrRetryRuntimeRecoveryWorkInputSchema)({
      id: "recovery_01",
      error: "Queue delivery failed.",
      claimedBy: null,
    });
    const normalizeInput = Schema.decodeUnknownSync(NormalizeRuntimeRecoveryStateInputSchema)({
      claimedBy: "runtime_owner_01",
    });

    expect(record.kind).toBe("queue_delivery");
    expect(record.scope).toEqual({
      kind: "workspace",
      workspaceId: "workspace_01" as WorkspaceId,
    });
    expect(snapshot.turns[0]?.status).toBe("running");
    expect(ensureInput.kind).toBe("workspace_generated_package_link_repair");
    expect(claimInput.claimedBy as string).toBe("runtime_owner_01");
    expect(claimInput.scope).toEqual({ kind: "app" });
    expect(completeInput.leaseVersion).toBe(1);
    expect(retryInput.error).toBe("Queue delivery failed.");
    expect(normalizeInput.claimedBy as string).toBe("runtime_owner_01");
  });

  it("rejects invalid runtime recovery work kind and scope pairs", () => {
    expect(() =>
      Schema.decodeUnknownSync(EnsureRuntimeRecoveryWorkInputSchema)({
        scope: { kind: "workspace", workspaceId: "workspace_01" },
        kind: "generated_package_refresh",
        ownerScope: { kind: "workspace" },
        idempotencyKey: "generated_package_refresh:workspace_01",
        orderingKey: "workspace:workspace_01",
        orderingSeq: 0,
        priority: 5,
        availableAt: "2026-06-21T12:34:56.789Z",
        maxAttempts: 5,
      }),
    ).toThrow("generated_package_refresh recovery work must be app-scoped");
    expect(() =>
      Schema.decodeUnknownSync(EnsureRuntimeRecoveryWorkInputSchema)({
        scope: { kind: "app" },
        kind: "workspace_generated_package_link_repair",
        ownerScope: { kind: "workspace" },
        idempotencyKey: "workspace_generated_package_link_repair:app",
        orderingKey: "app:generated-package-link",
        orderingSeq: 0,
        priority: 5,
        availableAt: "2026-06-21T12:34:56.789Z",
        maxAttempts: 5,
      }),
    ).toThrow("workspace_generated_package_link_repair recovery work must be workspace-scoped");
  });

  it("rejects removed runtime recovery kind names", () => {
    expect(() =>
      Schema.decodeUnknownSync(RuntimeRecoveryWorkKindSchema)("surface_turn_recovery"),
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(RuntimeRecoveryWorkKindSchema)("queue_drain")).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(RuntimeRecoveryWorkKindSchema)("initial_handler_start"),
    ).toThrow();
  });

  it("decodes runtime handler-thread start DTOs through public schemas", () => {
    const generatedAgentContextBinding = {
      aggregateCacheKey: "handler_context_cache_01",
      generatedAgentContextFingerprint: "context_fp_01",
      generatedAgentContextRevision: 1,
      externalSourceHashes: ["external_hash_01"],
    };
    const startInput = Schema.decodeUnknownSync(StartRuntimeHandlerThreadsInputSchema)({
      workspaceSessionId: "session_01",
      orchestratorTurnId: "turn_01",
      sourceCommandId: "cmd_thread_start_01",
      threadGroupId: null,
      threads: [
        {
          parentThreadId: "thread_parent_01",
          surfacePiSessionId: "pi_handler_01",
          title: "Runtime thread DTO audit",
          objective: "Investigate runtime thread DTO schemas.",
          historyMode: "isolated",
          worktreeId: null,
          agentProfileJson: '{"profile":"handler"}',
          generatedAgentContextBinding,
          initialQueue: {
            idempotencyKey: "initial_handler_start:thread_01",
            priority: "runtime",
            orderingKey: "surface:pi_handler_01",
            nextAttemptAt: null,
            maxAttempts: 1,
            overrides: {
              github: "available",
            },
          },
        },
      ],
    });
    const started = Schema.decodeUnknownSync(StartRuntimeHandlerThreadsResultSchema)({
      threadGroupId: "thread_group_01",
      threads: [
        {
          threadId: "thread_01",
          threadGroupId: "thread_group_01",
          workspaceSessionId: "session_01",
          surfacePiSessionId: "pi_handler_01",
          parentThreadId: "thread_parent_01",
          title: "Runtime thread DTO audit",
          objective: "Investigate runtime thread DTO schemas.",
          historyMode: "isolated",
          objectiveState: "active",
          status: "running-handler",
          wait: null,
          worktreeId: null,
          generatedAgentContextFingerprint: "context_fp_01",
          generatedAgentContextBindingId: "binding_01",
          queuedMessageId: "queue_initial_handler_01",
        },
      ],
    });
    const ensureInput = Schema.decodeUnknownSync(EnsureRuntimeHandlerThreadRunnableInputSchema)({
      workspaceSessionId: "session_01",
      surfacePiSessionId: "pi_handler_01",
      threadId: "thread_01",
    });
    const episode = Schema.decodeUnknownSync(RuntimeEpisodeRecordSchema)({
      id: "episode_01",
      sessionId: "session_01",
      threadId: "thread_01",
      threadGroupId: "thread_group_01",
      sourceCommandId: "cmd_thread_start_01",
      kind: "report",
      title: "Progress report",
      summary: "Schemas are now public.",
      body: "Runtime thread DTOs are schema-backed.",
      createdAt: "2026-06-21T12:35:56.789Z",
    });

    expect(startInput.threads[0]?.generatedAgentContextBinding.aggregateCacheKey).toBe(
      "handler_context_cache_01",
    );
    expect(started.threads[0]?.queuedMessageId as string).toBe("queue_initial_handler_01");
    expect(ensureInput.threadId as string).toBe("thread_01");
    expect(episode.kind).toBe("report");
    expect(() =>
      Schema.decodeUnknownSync(StartRuntimeHandlerThreadsInputSchema)({
        workspaceSessionId: "session_01",
        orchestratorTurnId: "turn_01",
        sourceCommandId: "cmd_thread_start_01",
        threads: [],
      }),
    ).toThrow();
  });

  it("decodes runtime thread read-model DTOs through public schemas", () => {
    const compactThread = {
      threadId: "thread_01",
      threadGroupId: "thread_group_01",
      workspaceSessionId: "session_01",
      surfacePiSessionId: "pi_handler_01",
      title: "Runtime thread DTO audit",
      objective: "Investigate runtime thread DTO schemas.",
      objectiveState: "active",
      status: "waiting",
      wait: {
        kind: "user",
        reason: "Waiting for clarification.",
        resumeWhen: "User answers.",
      },
      latestEpisode: {
        id: "episode_01",
        title: "Progress report",
        summary: "Schemas are now public.",
        createdAt: "2026-06-21T12:35:56.789Z",
      },
    };
    const current = Schema.decodeUnknownSync(RuntimeThreadCurrentReadModelSchema)({
      ...compactThread,
      pendingReportRequests: [
        {
          queuedMessageId: "queue_report_01",
          request: "Send current status.",
          createdAt: "2026-06-21T12:36:56.789Z",
        },
      ],
    });
    const list = Schema.decodeUnknownSync(RuntimeThreadListReadModelSchema)({
      threads: [compactThread],
    });
    const episodes = Schema.decodeUnknownSync(RuntimeThreadEpisodesReadModelSchema)({
      episodes: [
        {
          id: "episode_01",
          sessionId: "session_01",
          threadId: "thread_01",
          threadGroupId: "thread_group_01",
          sourceCommandId: "command_01",
          kind: "report",
          title: "Progress report",
          summary: "Schemas are now public.",
          body: "Runtime thread DTOs are schema-backed.",
          createdAt: "2026-06-21T12:35:56.789Z",
        },
      ],
    });
    const group = Schema.decodeUnknownSync(RuntimeThreadGroupReadModelSchema)({
      threadGroupId: "thread_group_01",
      currentThreadId: "thread_01",
      threads: [compactThread],
    });
    const listInput = Schema.decodeUnknownSync(ListRuntimeThreadsInputSchema)({
      workspaceSessionId: "session_01",
      status: ["waiting", "running-handler"],
      threadGroupId: "thread_group_01",
      limit: 10,
    });
    const episodesInput = Schema.decodeUnknownSync(ReadRuntimeThreadEpisodesInputSchema)({
      workspaceSessionId: "session_01",
      target: {
        kind: "thread",
        threadId: "thread_01",
      },
      limit: 5,
    });
    const currentInput = Schema.decodeUnknownSync(GetCurrentRuntimeThreadInputSchema)({
      workspaceSessionId: "session_01",
      threadId: "thread_01",
    });
    const groupInput = Schema.decodeUnknownSync(GetRuntimeThreadGroupInputSchema)({
      workspaceSessionId: "session_01",
      currentThreadId: "thread_01",
    });

    expect(current.pendingReportRequests[0]?.queuedMessageId as string).toBe("queue_report_01");
    expect(list.threads[0]?.status).toBe("waiting");
    expect(episodes.episodes[0]?.threadId as string).toBe("thread_01");
    expect(group.currentThreadId as string).toBe("thread_01");
    expect(listInput.status).toEqual(["waiting", "running-handler"]);
    expect(episodesInput.target.kind).toBe("thread");
    if (episodesInput.target.kind !== "thread") {
      throw new Error("Expected thread episodes target.");
    }
    expect(episodesInput.target.threadId as string).toBe("thread_01");
    expect(currentInput.threadId as string).toBe("thread_01");
    expect(groupInput.currentThreadId as string).toBe("thread_01");
    expect(() =>
      Schema.decodeUnknownSync(RuntimeThreadCurrentReadModelSchema)({
        ...compactThread,
        status: "started",
        pendingReportRequests: [],
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(ReadRuntimeThreadEpisodesInputSchema)({
        workspaceSessionId: "session_01",
        limit: 5,
      }),
    ).toThrow();
  });

  it("decodes runtime approval records and inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeApprovalRecordSchema)({
      requestId: "approval_01",
      sessionId: "session_01",
      surfacePiSessionId: "pi_session_01",
      threadId: null,
      turnId: "turn_01",
      commandId: "cmd_01",
      toolCallId: "tool_01",
      toolName: "exec_command",
      approvalMode: "auto-review",
      cwd: "/workspace",
      command: "bun test",
      commandFamily: "bun",
      patch: null,
      snippetArtifactId: null,
      typescriptCode: null,
      context: {
        reason: "sandbox_denial_escalation",
        sandboxDenied: true,
      },
      status: "pending",
      decisionReason: null,
      reviewer: null,
      createdAt: "2026-06-21T12:34:56.789Z",
      completedAt: null,
    });
    const createInput = Schema.decodeUnknownSync(CreateRuntimeApprovalRequestInputSchema)({
      sessionId: "session_01",
      surfacePiSessionId: "pi_session_01",
      toolCallId: "tool_01",
      toolName: "exec_command",
      approvalMode: "user",
      cwd: "/workspace",
      command: "bun test",
      context: {
        reason: "sandbox_denial_escalation",
        sandboxDenied: true,
      },
    });
    const resolveInput = Schema.decodeUnknownSync(ResolveRuntimeApprovalRequestInputSchema)({
      requestId: "approval_01",
      status: "approved",
      reviewer: "user",
      decisionReason: "Allowed by user.",
    });

    expect(record.status).toBe("pending");
    expect(createInput.toolName).toBe("exec_command");
    expect(resolveInput.status).toBe("approved");
  });

  it("rejects pending as a runtime approval resolution status", () => {
    expect(() =>
      Schema.decodeUnknownSync(ResolveRuntimeApprovalRequestInputSchema)({
        requestId: "approval_01",
        status: "pending",
        reviewer: "user",
      }),
    ).toThrow();
  });

  it("decodes runtime session wait inputs", () => {
    expect(
      Schema.decodeUnknownSync(SetRuntimeApprovalSessionWaitInputSchema)({
        sessionId: "session_01",
        owner: { kind: "orchestrator" },
        reason: "approval-pending",
        resumeWhen: "approval-resolved",
      }).owner.kind,
    ).toBe("orchestrator");
    expect(
      Schema.decodeUnknownSync(SetRuntimeUserSessionWaitInputSchema)({
        sessionId: "session_01",
        owner: { kind: "thread", threadId: "thread_01" },
        reason: "request-input-pending",
        resumeWhen: "request-input-answered",
      }).owner.kind,
    ).toBe("thread");
    expect(
      Schema.decodeUnknownSync(ClearRuntimeSessionWaitInputSchema)({
        sessionId: "session_01",
      }).sessionId as string,
    ).toBe("session_01");
  });

  it("decodes runtime artifact records and inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeArtifactMetadataRecordSchema)({
      artifactId: "artifact_01",
      workspaceSessionId: "session_01",
      threadId: null,
      workflowRunId: null,
      workflowTaskAttemptId: null,
      sourceCommandId: "cmd_01",
      name: "report.md",
      storedPath: "/workspace/report.md",
      mimeType: "text/markdown",
      byteSize: 128,
      sha256: "sha256-report",
      immutable: true,
      materializationStatus: "ready",
      createdAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:34:56.789Z",
      deletedAt: null,
      lastRecoveryWorkId: null,
    });
    const recordInput = Schema.decodeUnknownSync(RecordRuntimeArtifactMetadataInputSchema)({
      workspaceSessionId: "session_01",
      sourceCommandId: "cmd_01",
      kind: "text",
      name: "notes.txt",
      storedPath: "/workspace/notes.txt",
      mimeType: "text/plain",
      byteSize: 5,
      sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      immutable: false,
      materializationStatus: "ready",
    });
    const inspectInput = Schema.decodeUnknownSync(InspectRuntimeArtifactInputSchema)({
      workspaceSessionId: "session_01",
      artifactId: "artifact_01",
    });
    const deleteInput = Schema.decodeUnknownSync(MarkRuntimeArtifactMetadataDeletedInputSchema)({
      workspaceSessionId: "session_01",
      artifactId: "artifact_01",
    });
    const listInput = Schema.decodeUnknownSync(ListRuntimeArtifactsInputSchema)({
      workspaceSessionId: "session_01",
      threadId: null,
      limit: 20,
    });

    expect(record.materializationStatus).toBe("ready");
    expect(recordInput.byteSize).toBe(5);
    expect(inspectInput.artifactId as string).toBe("artifact_01");
    expect(deleteInput.artifactId as string).toBe("artifact_01");
    expect(listInput.limit).toBe(20);
  });
});
