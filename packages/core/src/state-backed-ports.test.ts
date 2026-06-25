import { describe, expect, it } from "bun:test";
import * as Schema from "effect/Schema";

import { SandboxPolicySnapshotSchema } from "./sandbox-policy-contracts";
import { SecretStatusSnapshotSchema } from "./secret-store-ports";
import { GeneratedPackageRefreshStatusSchema } from "./generated-package-contracts";
import {
  EnqueueRuntimeSurfaceMessageInputSchema,
  ClearRuntimeSessionWaitInputSchema,
  CancelRuntimeRequestInputInputSchema,
  CreateOrReuseStreamingRuntimeCommandInputSchema,
  CreateRuntimeApprovalRequestInputSchema,
  CreateRuntimeArtifactInputSchema,
  CreateRuntimeCommandInputSchema,
  CreateRuntimeRequestInputInputSchema,
  DefaultOpenRuntimeRequestInputQuestionsInputSchema,
  DeleteRuntimeArtifactInputSchema,
  FinishRuntimeCommandInputSchema,
  GetRuntimeRequestInputInputSchema,
  HasRuntimeCommandOutputEventInputSchema,
  InspectRuntimeArtifactInputSchema,
  ListRuntimeArtifactsInputSchema,
  ListOpenBlockingRuntimeRequestInputsInputSchema,
  MarkGeneratedPackageRefreshNeededInputSchema,
  RecordExtensionDependencyReadinessInputSchema,
  RecordRuntimeCommandEventInputSchema,
  ResolveRuntimeApprovalRequestInputSchema,
  ReadGeneratedPackageFactsInputSchema,
  ReadRuntimeSourceVersionInputSchema,
  ReconcileGeneratedPackageManifestInputSchema,
  RecordGeneratedPackageWorkspaceLinkInputSchema,
  RuntimeCommandRecordSchema,
  RecordRuntimeCommandStdinWriteInputSchema,
  RecordRuntimeSourceDeleteInputSchema,
  RecordRuntimeSourceSaveInputSchema,
  RuntimeApprovalRecordSchema,
  RuntimeActorExtensionBindingRecordSchema,
  RuntimeArtifactRecordSchema,
  RuntimeExtensionContextChangedSurfaceSchema,
  ExtensionDependencyReadinessSchema,
  RuntimeExtensionUsageProfileKeySchema,
  RuntimeGeneratedPackageFactRecordSchema,
  RuntimeGeneratedPackageWorkspaceLinkRecordSchema,
  RuntimeRecoveryStartupSnapshotSchema,
  RuntimeRecoveryWorkKindSchema,
  RuntimeRecoveryWorkRecordSchema,
  RuntimeRequestInputDetailsRecordSchema,
  RuntimeRequestInputRecordSchema,
  RuntimeSourceFactRecordSchema,
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
  StartRuntimeCommandInputSchema,
  StartRuntimeTurnInputSchema,
  SetRuntimeTurnDecisionInputSchema,
  FinishRuntimeTurnInputSchema,
  UpdateRuntimeCommandArgumentsInputSchema,
} from "./runtime-state-ports";

describe("@svvy/core state-backed port contracts", () => {
  it("decodes secret status snapshots without secret values", () => {
    const decoded = Schema.decodeUnknownSync(SecretStatusSnapshotSchema)({
      key: "openai.api_key",
      configured: true,
      redactedLabel: "sk-...abcd",
      revisionFingerprint: "secret_rev_01",
      updatedAt: "2026-06-21T12:34:56.789Z",
    });

    expect(decoded.key).toBe("openai.api_key");
    expect(decoded.configured).toBe(true);
    expect(decoded.redactedLabel).toBe("sk-...abcd");
    expect(decoded.revisionFingerprint).toBe("secret_rev_01");
    expect(decoded.updatedAt as string).toBe("2026-06-21T12:34:56.789Z");
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
      sourceKind: "workflow-agent",
      sourceId: "agent_reviewer",
    });
    const saveInput = Schema.decodeUnknownSync(RecordRuntimeSourceSaveInputSchema)({
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
      sourceKind: "workflow-agent",
      sourceId: "agent_reviewer",
      expectedSourceVersion: "source_version_02",
      sourceCommandId: "cmd_02",
      deletedAt: "2026-06-21T12:35:56.789Z",
    });

    expect(record.sourceVersion as string).toBe("source_version_02");
    expect(record.sourceCommandId as string).toBe("cmd_01");
    expect(record.deletedAt).toBeNull();
    expect(readInput.sourceId).toBe("agent_reviewer");
    expect(saveInput.previousSourceVersion).toBe("source_version_01");
    expect(deleteInput.expectedSourceVersion).toBe("source_version_02");
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
    const decoded = Schema.decodeUnknownSync(GeneratedPackageRefreshStatusSchema)({
      packageName: "@svvyx/workflows",
      action: "written",
      buildId: "gen_build_workflows_01",
      dependencies: [
        {
          kind: "package",
          name: "@svvy/core",
          version: "workspace",
          resolution: "app-owned-package",
        },
        {
          kind: "generated-package",
          name: "@svvyx/extensions",
          buildId: "gen_build_extensions_01",
          resolution: "generated-package-link",
        },
      ],
    });

    expect(decoded.dependencies?.[0]).toEqual({
      kind: "package",
      name: "@svvy/core",
      version: "workspace",
      resolution: "app-owned-package",
    });
    expect(decoded.dependencies?.[1]?.kind).toBe("generated-package");
    if (decoded.dependencies?.[1]?.kind !== "generated-package") {
      throw new Error("expected generated package dependency evidence");
    }
    expect(decoded.dependencies[1].name).toBe("@svvyx/extensions");
    expect(decoded.dependencies[1].buildId as string).toBe("gen_build_extensions_01");
    expect(decoded.dependencies[1].resolution).toBe("generated-package-link");
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
          kind: "package",
          name: "@svvy/core",
          version: "workspace",
          resolution: "app-owned-package",
        },
        {
          kind: "generated-package",
          name: "@svvyx/extensions",
          buildId: "gen_build_extensions_01",
          resolution: "generated-package-link",
        },
      ],
      diagnostics: [],
      sourceCommandId: "cmd_generated_package_01",
      refreshNeededReason: null,
      lastRecoveryWorkId: "recovery_generated_package_01",
      createdAt: "2026-06-21T12:34:56.789Z",
      updatedAt: "2026-06-21T12:35:56.789Z",
    });

    expect(decoded.dependencies[0]?.kind).toBe("package");
    expect(decoded.dependencies[1]?.kind).toBe("generated-package");
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

  it("decodes runtime generated-package workspace link records and inputs", () => {
    const record = Schema.decodeUnknownSync(RuntimeGeneratedPackageWorkspaceLinkRecordSchema)({
      workspaceId: "wksp_01",
      packageName: "@svvyx/workflows",
      status: "linked",
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

    expect(record.status).toBe("linked");
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
      Schema.decodeUnknownSync(ReconcileGeneratedPackageManifestInputSchema)({
        fact: {
          packageName: "@svvyx/extensions",
          buildId: "gen_build_extensions_01",
          manifestPath: "/app/generated/extensions/.svvy-generated-package.json",
          sourceFingerprint: "source-fingerprint-01",
          outputFingerprint: "output-fingerprint-01",
          generatedFileListDigest: "files-digest-01",
          dependencies: [
            {
              kind: "package",
              name: "@svvy/core",
              version: "workspace",
              resolution: "app-owned-package",
            },
          ],
        },
        diagnostics: [],
        recoveryWorkId: "recovery_generated_package_01",
      }).fact.packageName,
    ).toBe("@svvyx/extensions");
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
      workspaceId: "workspace_01",
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
    expect(snapshot.turns[0]?.status).toBe("running");
    expect(ensureInput.kind).toBe("workspace_generated_package_link_repair");
    expect(claimInput.claimedBy as string).toBe("runtime_owner_01");
    expect(completeInput.leaseVersion).toBe(1);
    expect(retryInput.error).toBe("Queue delivery failed.");
    expect(normalizeInput.claimedBy as string).toBe("runtime_owner_01");
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
    const record = Schema.decodeUnknownSync(RuntimeArtifactRecordSchema)({
      id: "artifact_01",
      sessionId: "session_01",
      threadId: null,
      workflowRunId: null,
      workflowTaskAttemptId: null,
      sourceCommandId: "cmd_01",
      kind: "file",
      name: "report.md",
      path: "/workspace/report.md",
      mimeType: "text/markdown",
      bytes: 128,
      sha256: "sha256-report",
      immutable: true,
      createdAt: "2026-06-21T12:34:56.789Z",
      deletedAt: null,
    });
    const createInput = Schema.decodeUnknownSync(CreateRuntimeArtifactInputSchema)({
      sessionId: "session_01",
      sourceCommandId: "cmd_01",
      kind: "text",
      name: "notes.txt",
      content: "hello",
      mimeType: "text/plain",
      immutable: false,
    });
    const inspectInput = Schema.decodeUnknownSync(InspectRuntimeArtifactInputSchema)({
      sessionId: "session_01",
      artifactId: "artifact_01",
    });
    const deleteInput = Schema.decodeUnknownSync(DeleteRuntimeArtifactInputSchema)({
      sessionId: "session_01",
      artifactId: "artifact_01",
    });
    const listInput = Schema.decodeUnknownSync(ListRuntimeArtifactsInputSchema)({
      sessionId: "session_01",
      threadId: null,
      limit: 20,
    });

    expect(record.kind).toBe("file");
    expect(createInput.kind).toBe("text");
    expect(inspectInput.artifactId as string).toBe("artifact_01");
    expect(deleteInput.artifactId as string).toBe("artifact_01");
    expect(listInput.limit).toBe(20);
  });
});
