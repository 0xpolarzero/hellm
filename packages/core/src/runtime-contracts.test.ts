import { describe, expect, it } from "bun:test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  RUNTIME_TURN_DECISIONS,
  RuntimeEventsInputSchema,
  RuntimeTurnDecisionSchema,
  decodeAcquireDefaultWorkspaceInput as decodeAcquireDefaultWorkspaceInputRaw,
  decodeAcquireWorkspaceInput as decodeAcquireWorkspaceInputRaw,
  decodeAcquireWorkspaceResult as decodeAcquireWorkspaceResultRaw,
  decodeAuthenticatedRunTaskAgentInput as decodeAuthenticatedRunTaskAgentInputRaw,
  decodeAbortPromptInput as decodeAbortPromptInputRaw,
  decodeAnswerRuntimeApprovalInput as decodeAnswerRuntimeApprovalInputRaw,
  decodeAnswerRuntimeApprovalResult as decodeAnswerRuntimeApprovalResultRaw,
  decodeAnswerRequestInputInput as decodeAnswerRequestInputInputRaw,
  decodeAnswerRequestInputResult as decodeAnswerRequestInputResultRaw,
  decodeCancelCommandInput as decodeCancelCommandInputRaw,
  decodeCloseSurfaceInput as decodeCloseSurfaceInputRaw,
  decodeCloseSurfaceResult as decodeCloseSurfaceResultRaw,
  decodeCommandResultEnvelope as decodeCommandResultEnvelopeRaw,
  decodeCreateOrchestratorSurfaceInput as decodeCreateOrchestratorSurfaceInputRaw,
  decodeCreateSurfaceResult as decodeCreateSurfaceResultRaw,
  decodeCommandResultEnvelopeExit,
  decodeCreateRequestInputRequest as decodeCreateRequestInputRequestRaw,
  decodeExtensionExecutionPlan as decodeExtensionExecutionPlanRaw,
  decodeExtensionExecutionPlanExit,
  decodeExtensionHandlerResult as decodeExtensionHandlerResultRaw,
  decodeGeneratedPackagesRefreshResult as decodeGeneratedPackagesRefreshResultRaw,
  decodeRefreshGeneratedContextRequest as decodeRefreshGeneratedContextRequestRaw,
  decodeRequestUserInputAnswerDeliveryPayload as decodeRequestUserInputAnswerDeliveryPayloadRaw,
  decodeRequestUserInputAnswerQueuePayload as decodeRequestUserInputAnswerQueuePayloadRaw,
  decodeRunExtensionDependencyActionInput as decodeRunExtensionDependencyActionInputRaw,
  decodeRunExtensionDependencyActionResult as decodeRunExtensionDependencyActionResultRaw,
  unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap as decodeRuntimeEffectRequestRaw,
  decodeRuntimeEvent as decodeRuntimeEventRaw,
  decodeRuntimeEventError as decodeRuntimeEventErrorRaw,
  decodeRuntimeEventExit,
  decodeRuntimeEventsInput as decodeRuntimeEventsInputRaw,
  decodeUnknownRuntimeFacadeErrorContractExit,
  decodeUnknownStateFacadeErrorContractExit,
  unsafeDecodeRuntimeFacadeErrorContractSyncForTestsAndBootstrap,
  unsafeDecodeStateFacadeErrorContractSyncForTestsAndBootstrap,
  decodeRuntimeSubmittedMessage as decodeRuntimeSubmittedMessageRaw,
  decodeRuntimeSubmittedMessageExit,
  decodeOpenSurfaceInput as decodeOpenSurfaceInputRaw,
  decodeOpenSurfaceResult as decodeOpenSurfaceResultRaw,
  decodeReleaseWorkspaceInput as decodeReleaseWorkspaceInputRaw,
  decodeReleaseWorkspaceResult as decodeReleaseWorkspaceResultRaw,
  decodeSetRequestInputTimerPausedInput as decodeSetRequestInputTimerPausedInputRaw,
  decodeSourceInvalidationHint as decodeSourceInvalidationHintRaw,
  decodeSourceReconcileRequest as decodeSourceReconcileRequestRaw,
  decodeSourceReconcileResult as decodeSourceReconcileResultRaw,
  decodeStateInvalidationDescriptor as decodeStateInvalidationDescriptorRaw,
  decodeSteerQueuedMessageInput as decodeSteerQueuedMessageInputRaw,
  decodeSubmitMessageInput as decodeSubmitMessageInputRaw,
  decodeSubmitMessageInputExit,
  decodeSubmitMessageResult as decodeSubmitMessageResultRaw,
  decodeUnknownSvvyxRuntimeEffectTransportIntentExit,
  decodeWriteCommandStdinInput as decodeWriteCommandStdinInputRaw,
  decodeWriteCommandStdinResult as decodeWriteCommandStdinResultRaw,
  unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap as decodeRunTaskAgentInputRaw,
  unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap as decodeRunTaskAgentSourceInputRaw,
  unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap as decodeRunTaskAgentResultRaw,
  unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap as decodeRunTaskAgentErrorRaw,
} from "./runtime-contracts";
import {
  decodeGeneratedPackageBuildInput as decodeGeneratedPackageBuildInputRaw,
  decodeGeneratedPackageBuildPlanResult as decodeGeneratedPackageBuildPlanResultRaw,
  decodeGeneratedPackageWorkspaceLinkRepairInput as decodeGeneratedPackageWorkspaceLinkRepairInputRaw,
  decodeRefreshGeneratedPackagesRequest as decodeRefreshGeneratedPackagesRequestRaw,
} from "./generated-package-contracts";
import { RuntimeEventRebaselineRequired } from "./errors";
import type {
  AppLogEntryId,
  IsoDateTimeString,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  SurfacePiSessionId,
  WorkspaceId,
} from "./ids";
import {
  decodeNativeToolResult as decodeNativeToolResultRaw,
  decodeNativeToolResultExit,
} from "./native-tool-contracts";

const decodeSubmitMessageInput = (input: unknown) => decodeSubmitMessageInputRaw(input);
const decodeRuntimeEvent = (input: unknown) => decodeRuntimeEventRaw(input);
const decodeRuntimeEventError = (input: unknown) => decodeRuntimeEventErrorRaw(input);
const decodeRuntimeFacadeErrorContract = (input: unknown) =>
  unsafeDecodeRuntimeFacadeErrorContractSyncForTestsAndBootstrap(input);
const decodeStateFacadeErrorContract = (input: unknown) =>
  unsafeDecodeStateFacadeErrorContractSyncForTestsAndBootstrap(input);
const decodeRuntimeSubmittedMessage = (input: unknown) => decodeRuntimeSubmittedMessageRaw(input);
const unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap = (input: unknown) =>
  decodeRuntimeEffectRequestRaw(input);
const decodeAbortPromptInput = (input: unknown) => decodeAbortPromptInputRaw(input);
const decodeSteerQueuedMessageInput = (input: unknown) => decodeSteerQueuedMessageInputRaw(input);
const decodeRuntimeEventsInput = (input: unknown) => decodeRuntimeEventsInputRaw(input);
const decodeSubmitMessageResult = (input: unknown) => decodeSubmitMessageResultRaw(input);
const decodeAcquireWorkspaceInput = (input: unknown) => decodeAcquireWorkspaceInputRaw(input);
const decodeAcquireDefaultWorkspaceInput = (input: unknown) =>
  decodeAcquireDefaultWorkspaceInputRaw(input);
const decodeAcquireWorkspaceResult = (input: unknown) => decodeAcquireWorkspaceResultRaw(input);
const decodeReleaseWorkspaceInput = (input: unknown) => decodeReleaseWorkspaceInputRaw(input);
const decodeReleaseWorkspaceResult = (input: unknown) => decodeReleaseWorkspaceResultRaw(input);
const decodeCreateOrchestratorSurfaceInput = (input: unknown) =>
  decodeCreateOrchestratorSurfaceInputRaw(input);
const decodeCreateSurfaceResult = (input: unknown) => decodeCreateSurfaceResultRaw(input);
const decodeOpenSurfaceInput = (input: unknown) => decodeOpenSurfaceInputRaw(input);
const decodeOpenSurfaceResult = (input: unknown) => decodeOpenSurfaceResultRaw(input);
const decodeCloseSurfaceInput = (input: unknown) => decodeCloseSurfaceInputRaw(input);
const decodeCloseSurfaceResult = (input: unknown) => decodeCloseSurfaceResultRaw(input);
const decodeCancelCommandInput = (input: unknown) => decodeCancelCommandInputRaw(input);
const decodeWriteCommandStdinInput = (input: unknown) => decodeWriteCommandStdinInputRaw(input);
const decodeWriteCommandStdinResult = (input: unknown) => decodeWriteCommandStdinResultRaw(input);
const decodeStateInvalidationDescriptor = (input: unknown) =>
  decodeStateInvalidationDescriptorRaw(input);
const decodeRunExtensionDependencyActionInput = (input: unknown) =>
  decodeRunExtensionDependencyActionInputRaw(input);
const decodeRunExtensionDependencyActionResult = (input: unknown) =>
  decodeRunExtensionDependencyActionResultRaw(input);
const decodeCommandResultEnvelope = (input: unknown) => decodeCommandResultEnvelopeRaw(input);
const decodeNativeToolResult = (input: unknown) => decodeNativeToolResultRaw(input);
const decodeExtensionExecutionPlan = (input: unknown) => decodeExtensionExecutionPlanRaw(input);
const decodeExtensionHandlerResult = (input: unknown) => decodeExtensionHandlerResultRaw(input);
const decodeCreateRequestInputRequest = (input: unknown) =>
  decodeCreateRequestInputRequestRaw(input);
const decodeRequestUserInputAnswerQueuePayload = (input: unknown) =>
  decodeRequestUserInputAnswerQueuePayloadRaw(input);
const decodeRequestUserInputAnswerDeliveryPayload = (input: unknown) =>
  decodeRequestUserInputAnswerDeliveryPayloadRaw(input);
const decodeAnswerRequestInputInput = (input: unknown) => decodeAnswerRequestInputInputRaw(input);
const decodeAnswerRequestInputResult = (input: unknown) => decodeAnswerRequestInputResultRaw(input);
const decodeSetRequestInputTimerPausedInput = (input: unknown) =>
  decodeSetRequestInputTimerPausedInputRaw(input);
const decodeAnswerRuntimeApprovalInput = (input: unknown) =>
  decodeAnswerRuntimeApprovalInputRaw(input);
const decodeAnswerRuntimeApprovalResult = (input: unknown) =>
  decodeAnswerRuntimeApprovalResultRaw(input);
const decodeSourceInvalidationHint = (input: unknown) => decodeSourceInvalidationHintRaw(input);
const decodeSourceReconcileRequest = (input: unknown) => decodeSourceReconcileRequestRaw(input);
const decodeSourceReconcileResult = (input: unknown) => decodeSourceReconcileResultRaw(input);
const decodeRefreshGeneratedContextRequest = (input: unknown) =>
  decodeRefreshGeneratedContextRequestRaw(input);
const decodeRefreshGeneratedPackagesRequest = (input: unknown) =>
  decodeRefreshGeneratedPackagesRequestRaw(input);
const decodeGeneratedPackageBuildInput = (input: unknown) =>
  decodeGeneratedPackageBuildInputRaw(input);
const decodeGeneratedPackagesRefreshResult = (input: unknown) =>
  decodeGeneratedPackagesRefreshResultRaw(input);
const decodeGeneratedPackageBuildPlanResult = (input: unknown) =>
  decodeGeneratedPackageBuildPlanResultRaw(input);
const decodeGeneratedPackageWorkspaceLinkRepairInput = (input: unknown) =>
  decodeGeneratedPackageWorkspaceLinkRepairInputRaw(input);
const unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap = (input: unknown) =>
  decodeRunTaskAgentResultRaw(input);
const unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap = (input: unknown) =>
  decodeRunTaskAgentErrorRaw(input);
const unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap = (input: unknown) =>
  decodeRunTaskAgentInputRaw(input);
const unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap = (input: unknown) =>
  decodeRunTaskAgentSourceInputRaw(input);
const decodeAuthenticatedRunTaskAgentInput = (input: unknown) =>
  decodeAuthenticatedRunTaskAgentInputRaw(input);

const handlerTarget = {
  workspaceSessionId: "wsess_01",
  surface: "handler",
  surfacePiSessionId: "pi_handler_01",
  threadId: "thread_01",
} as const;

const orchestratorTarget = {
  workspaceSessionId: "wsess_01",
  surface: "orchestrator",
  surfacePiSessionId: "pi_orch_01",
} as const;

const workflowTaskTarget = {
  workspaceSessionId: "wsess_01",
  surface: "workflow-task",
  surfacePiSessionId: "pi_workflow_task_01",
  threadId: "thread_01",
  workflowTaskAttemptId: "wfta_01",
  workflowRunId: "wfr_01",
} as const;

const extensionExecutionEnvPlan = {
  extensionId: "shell",
  nonSecretValues: {
    CI: "1",
  },
  secretKeyNames: ["GITHUB_TOKEN"],
  redactedLabels: {
    GITHUB_TOKEN: "configured",
  },
  secretRevisionFingerprint: "secret-revision-01",
} as const;

const childProcessExecutionPlan = {
  type: "child_process.command",
  planId: "plan_child_01",
  commandFamily: "shell",
  command: {
    argv: ["bun", "test"],
  },
  cwd: "/Users/example/project",
  env: extensionExecutionEnvPlan,
  stdin: "none",
} as const;

const applyPatchExecutionPlan = {
  type: "file_effect.apply_patch",
  planId: "plan_patch_01",
  patch: "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch\n",
  cwd: "/Users/example/project",
} as const;

describe("@svvy/core runtime contracts", () => {
  it("defines the shared non-pending turn decision inventory", () => {
    expect([...RUNTIME_TURN_DECISIONS]).toEqual([
      "reply",
      "exec_command",
      "write_stdin",
      "apply_patch",
      "execute_typescript",
      "list_extensions",
      "load_extension",
      "thread_start",
      "thread_followup",
      "thread_list",
      "thread_request_report",
      "thread_current",
      "thread_group",
      "thread_report",
      "thread_episodes",
      "request_user_input",
    ]);
    const isRuntimeTurnDecision = Schema.is(RuntimeTurnDecisionSchema);
    expect(isRuntimeTurnDecision("thread_start")).toBe(true);
    expect(isRuntimeTurnDecision("pending")).toBe(false);
  });

  it("decodes runtime workspace lifecycle contracts without UI pane state", () => {
    const owner = { ownerId: "owner_headless_01", kind: "headless" } as const;

    expect(
      decodeAcquireWorkspaceInput({
        cwd: "/repo/svvy",
        owner,
        openReason: "headless",
      }) as unknown,
    ).toEqual({
      cwd: "/repo/svvy",
      owner,
      openReason: "headless",
    });

    expect(
      decodeAcquireDefaultWorkspaceInput({
        owner,
        openReason: "startup",
      }) as unknown,
    ).toEqual({
      owner,
      openReason: "startup",
    });

    expect(
      decodeAcquireWorkspaceResult({
        workspaceId: "workspace_01",
        cwd: "/repo/svvy",
        kind: "user",
        acquired: "created",
        readiness: "ready",
        readinessDetail: { mode: "full" },
        stateRevision: 42,
      }) as unknown,
    ).toEqual({
      workspaceId: "workspace_01",
      cwd: "/repo/svvy",
      kind: "user",
      acquired: "created",
      readiness: "ready",
      readinessDetail: { mode: "full" },
      stateRevision: 42,
    });

    expect(
      decodeReleaseWorkspaceInput({
        workspaceId: "workspace_01",
        owner,
        releaseReason: "headless-complete",
      }) as unknown,
    ).toEqual({
      workspaceId: "workspace_01",
      owner,
      releaseReason: "headless-complete",
    });

    expect(
      decodeReleaseWorkspaceResult({
        workspaceId: "workspace_01",
        released: true,
        remainingOwners: 0,
        lifecycle: "disposed",
      }) as unknown,
    ).toEqual({
      workspaceId: "workspace_01",
      released: true,
      remainingOwners: 0,
      lifecycle: "disposed",
    });
  });

  it("decodes runtime surface lifecycle contracts without renderer panel identity", () => {
    expect(
      decodeCreateOrchestratorSurfaceInput({
        workspaceId: "workspace_01",
        title: "Package refactor",
        profileId: "profile_orchestrator",
        clientSubmission: { source: "headless", clientRequestId: "surface-create-01" },
      }) as unknown,
    ).toEqual({
      workspaceId: "workspace_01",
      title: "Package refactor",
      profileId: "profile_orchestrator",
      clientSubmission: { source: "headless", clientRequestId: "surface-create-01" },
    });

    expect(
      decodeCreateSurfaceResult({
        workspaceSessionId: orchestratorTarget.workspaceSessionId,
        surfacePiSessionId: orchestratorTarget.surfacePiSessionId,
        target: orchestratorTarget,
        created: "new",
        stateRevision: 43,
      }) as unknown,
    ).toEqual({
      workspaceSessionId: orchestratorTarget.workspaceSessionId,
      surfacePiSessionId: orchestratorTarget.surfacePiSessionId,
      target: orchestratorTarget,
      created: "new",
      stateRevision: 43,
    });

    expect(
      decodeOpenSurfaceInput({
        workspaceId: "workspace_01",
        target: orchestratorTarget,
      }) as unknown,
    ).toEqual({
      workspaceId: "workspace_01",
      target: orchestratorTarget,
    });

    expect(
      decodeOpenSurfaceResult({
        workspaceSessionId: handlerTarget.workspaceSessionId,
        surfacePiSessionId: handlerTarget.surfacePiSessionId,
        target: handlerTarget,
        stateRevision: 44,
      }) as unknown,
    ).toEqual({
      workspaceSessionId: handlerTarget.workspaceSessionId,
      surfacePiSessionId: handlerTarget.surfacePiSessionId,
      target: handlerTarget,
      stateRevision: 44,
    });

    expect(
      decodeCloseSurfaceInput({
        target: handlerTarget,
        closeReason: "pane-closed",
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      closeReason: "pane-closed",
    });

    expect(
      decodeCloseSurfaceResult({
        target: handlerTarget,
        lifecycle: "idle",
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      lifecycle: "idle",
    });
  });

  it("decodes an orchestrator prompt submission without renderer panel identity", () => {
    expect(
      decodeSubmitMessageInput({
        target: {
          workspaceSessionId: "wsess_01",
          surface: "orchestrator",
          surfacePiSessionId: "pi_orch_01",
        },
        message: {
          text: "Refactor the transcript projection and report risks.",
        },
        delivery: "enqueue-and-run",
        clientSubmission: {
          correlationId: "visual-test-42",
          source: "headless",
        },
      }) as unknown,
    ).toEqual({
      target: {
        workspaceSessionId: "wsess_01",
        surface: "orchestrator",
        surfacePiSessionId: "pi_orch_01",
      },
      message: {
        text: "Refactor the transcript projection and report risks.",
      },
      delivery: "enqueue-and-run",
      clientSubmission: {
        correlationId: "visual-test-42",
        source: "headless",
      },
    });
  });

  it("rejects prompt submissions with explicit undefined delivery", () => {
    expect(() =>
      decodeSubmitMessageInput({
        target: orchestratorTarget,
        message: {
          text: "Refactor the transcript projection and report risks.",
        },
        delivery: undefined,
      }),
    ).toThrow();
  });

  it("decodes request-input answer and timer metadata without renderer panel identity", () => {
    expect(
      decodeAnswerRequestInputInput({
        surfacePiSessionId: "pi_orch_01",
        requestId: "rui_01",
        questionId: "ruiq_01",
        answer: { kind: "option", optionId: "ruio_01" },
        delivery: "enqueue-and-run",
        clientSubmission: {
          correlationId: "visual-test-answer-42",
          source: "request-input-panel",
        },
      }) as unknown,
    ).toEqual({
      surfacePiSessionId: "pi_orch_01",
      requestId: "rui_01",
      questionId: "ruiq_01",
      answer: { kind: "option", optionId: "ruio_01" },
      delivery: "enqueue-and-run",
      clientSubmission: {
        correlationId: "visual-test-answer-42",
        source: "request-input-panel",
      },
    });
    expect(
      decodeSetRequestInputTimerPausedInput({
        surfacePiSessionId: "pi_orch_01",
        requestId: "rui_01",
        paused: true,
        clientSubmission: {
          correlationId: "visual-test-timer-42",
          source: "request-input-panel",
        },
      }) as unknown,
    ).toEqual({
      surfacePiSessionId: "pi_orch_01",
      requestId: "rui_01",
      paused: true,
      clientSubmission: {
        correlationId: "visual-test-timer-42",
        source: "request-input-panel",
      },
    });
    expect(
      decodeAnswerRequestInputResult({
        requestId: "rui_01",
        questionId: "ruiq_01",
        status: "recorded",
        delivery: {
          kind: "nonblocking-queued",
          queuedItemId: "queue_01",
        },
      }) as unknown,
    ).toEqual({
      requestId: "rui_01",
      questionId: "ruiq_01",
      status: "recorded",
      delivery: {
        kind: "nonblocking-queued",
        queuedItemId: "queue_01",
      },
    });
    expect(
      decodeAnswerRequestInputResult({
        requestId: "rui_01",
        questionId: "ruiq_01",
        status: "duplicate",
        delivery: {
          kind: "nonblocking-recorded",
          queuedItemId: null,
        },
      }) as unknown,
    ).toEqual({
      requestId: "rui_01",
      questionId: "ruiq_01",
      status: "duplicate",
      delivery: {
        kind: "nonblocking-recorded",
        queuedItemId: null,
      },
    });
    expect(() =>
      decodeAnswerRequestInputResult({
        queuedItemId: "queue_01",
      }),
    ).toThrow();

    expect(() =>
      decodeAnswerRequestInputInput({
        surfacePiSessionId: "pi_orch_01",
        requestId: "rui_01",
        questionId: "ruiq_01",
        answer: { kind: "custom", text: "Yes" },
        delivery: "enqueue-and-run",
        clientSubmission: {
          correlationId: "visual-test-answer-42",
          source: "request-input-panel",
          panelId: "panel_renderer_local",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeSetRequestInputTimerPausedInput({
        surfacePiSessionId: "pi_orch_01",
        requestId: "rui_01",
        paused: false,
        clientSubmission: {
          correlationId: "visual-test-timer-42",
          source: "request-input-panel",
          panelId: "panel_renderer_local",
        },
      }),
    ).toThrow();
  });

  it("exposes Exit decoders for non-Effect bridge edges", () => {
    const success = decodeSubmitMessageInputExit({
      target: orchestratorTarget,
      message: { text: "Run a focused check." },
      delivery: "queue-only",
    });
    expect(Exit.isSuccess(success)).toBe(true);
    if (Exit.isSuccess(success)) {
      expect(success.value.delivery).toBe("queue-only");
    }

    expect(Exit.isFailure(decodeRuntimeEventExit({ type: "queue.changed" }))).toBe(true);
    expect(
      Exit.isSuccess(
        decodeUnknownRuntimeFacadeErrorContractExit({
          type: "runtime-facade-error",
          reason: "disposed",
        }),
      ),
    ).toBe(true);
    expect(Exit.isSuccess(decodeCommandResultEnvelopeExit({ status: "succeeded" }))).toBe(true);
    expect(Exit.isFailure(decodeNativeToolResultExit({ type: "tool_result" }))).toBe(true);
  });

  it("rejects obsolete active-turn steer delivery on runtime submissions", () => {
    expect(() =>
      decodeSubmitMessageInput({
        target: orchestratorTarget,
        message: {
          text: "Use this as a steering message.",
        },
        delivery: "steer",
      }),
    ).toThrow();
  });

  it("rejects renderer-local fields on the runtime submission contract", () => {
    expect(() =>
      decodeSubmitMessageInput({
        target: {
          workspaceSessionId: "wsess_01",
          surface: "orchestrator",
          surfacePiSessionId: "pi_orch_01",
        },
        message: { text: "hello" },
        clientSubmission: {
          correlationId: "visual-test-42",
          panelId: "primary",
        },
      }),
    ).toThrow();
  });

  it("decodes composer attachments and sent snippet provenance on submitted messages", () => {
    const message = {
      text: "Review these files.",
      attachments: [
        {
          id: "att_file",
          kind: "file",
          name: "runtime.ts",
          path: "/repo/src/runtime.ts",
          workspaceRelativePath: "src/runtime.ts",
          mimeType: "text/typescript",
          sizeBytes: 120,
        },
        {
          id: "att_folder",
          kind: "folder",
          name: "src",
          path: "/repo/src",
          workspaceRelativePath: "src",
        },
        {
          id: "att_image",
          kind: "image",
          name: "trace.png",
          dataBase64: "aW1hZ2U=",
          mimeType: "image/png",
        },
      ],
      snippetProvenance: [
        {
          mentionId: "mention_1",
          snippetId: "snippet_1",
          source: "svvy",
          title: "Bug report",
          path: "/repo/.svvy/snippets/bug.md",
          contentHash: "hash_1",
          arguments: ["transcript"],
          resolvedText: "Inspect the transcript.",
        },
      ],
    };

    expect(
      decodeSubmitMessageInput({
        target: {
          workspaceSessionId: "wsess_01",
          surface: "orchestrator",
          surfacePiSessionId: "pi_orch_01",
        },
        message,
      }) as unknown,
    ).toMatchObject({
      message: {
        attachments: [
          { kind: "file", workspaceRelativePath: "src/runtime.ts" },
          { kind: "folder", workspaceRelativePath: "src" },
          { kind: "image", mimeType: "image/png" },
        ],
        snippetProvenance: [{ mentionId: "mention_1", snippetId: "snippet_1" }],
      },
    });
    expect(decodeRuntimeSubmittedMessage(message)).toMatchObject({
      attachments: [
        { kind: "file", workspaceRelativePath: "src/runtime.ts" },
        { kind: "folder", workspaceRelativePath: "src" },
        { kind: "image", mimeType: "image/png" },
      ],
      snippetProvenance: [{ mentionId: "mention_1", snippetId: "snippet_1" }],
    });
    expect(Exit.isSuccess(decodeRuntimeSubmittedMessageExit(message))).toBe(true);
  });

  it("rejects transcript arrays and system prompts on submitted messages", () => {
    expect(() =>
      decodeSubmitMessageInput({
        target: {
          workspaceSessionId: "wsess_01",
          surface: "orchestrator",
          surfacePiSessionId: "pi_orch_01",
        },
        messages: [{ role: "user", content: "hello" }],
        systemPrompt: "hidden prompt",
        message: { text: "hello" },
      }),
    ).toThrow();
  });

  it("rejects pi-native message fields on standalone runtime submitted messages", () => {
    expect(() =>
      decodeRuntimeSubmittedMessage({
        role: "user",
        timestamp: 1,
        content: [{ type: "text", text: "hello" }],
        text: "hello",
      }),
    ).toThrow();
    expect(Exit.isFailure(decodeRuntimeSubmittedMessageExit({ role: "user" }))).toBe(true);
  });

  it("rejects the old public thread surface name", () => {
    expect(() =>
      decodeSubmitMessageInput({
        target: {
          workspaceSessionId: "wsess_01",
          surface: "thread",
          surfacePiSessionId: "pi_handler_01",
          threadId: "thread_01",
        },
        message: { text: "hello" },
      }),
    ).toThrow();
  });

  it("decodes compact runtime notification events", () => {
    expect(
      decodeRuntimeEvent({
        type: "queue.changed",
        eventGenerationId: "runtime-events-generation-01",
        sequence: 7,
        workspaceId: "workspace_01",
        target: workflowTaskTarget,
        queuedMessageId: "queue_7f2",
        status: "dispatching",
      }) as unknown,
    ).toEqual({
      type: "queue.changed",
      eventGenerationId: "runtime-events-generation-01",
      sequence: 7,
      workspaceId: "workspace_01",
      target: workflowTaskTarget,
      queuedMessageId: "queue_7f2",
      status: "dispatching",
    });
  });

  it("rejects runtime notification events without sequence cursors", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "queue.changed",
        workspaceId: "workspace_01",
        target: workflowTaskTarget,
        queuedMessageId: "queue_7f2",
        status: "dispatching",
      }),
    ).toThrow();
  });

  it("decodes typed stream patches and read-model invalidations", () => {
    expect(
      decodeRuntimeEvent({
        type: "surface.stream",
        workspaceId: "workspace_01",
        target: orchestratorTarget,
        eventGenerationId: "runtime-events-generation-01",
        sequence: 42,
        streamGenerationId: "surface-stream-generation-01",
        streamSequence: 9,
        patch: {
          type: "assistant_text_delta",
          messageId: "msg_01",
          contentIndex: 0,
          delta: "Working through the queue.",
        },
      }) as unknown,
    ).toEqual({
      type: "surface.stream",
      workspaceId: "workspace_01",
      target: orchestratorTarget,
      eventGenerationId: "runtime-events-generation-01",
      sequence: 42,
      streamGenerationId: "surface-stream-generation-01",
      streamSequence: 9,
      patch: {
        type: "assistant_text_delta",
        messageId: "msg_01",
        contentIndex: 0,
        delta: "Working through the queue.",
      },
    });

    expect(
      decodeRuntimeEvent({
        type: "workspace_read_model.changed",
        eventGenerationId: "runtime-events-generation-01",
        sequence: 43,
        workspaceId: "workspace_01",
        invalidation: {
          model: "commandInspector",
          ids: ["cmd_01"],
        },
      }) as unknown,
    ).toEqual({
      type: "workspace_read_model.changed",
      eventGenerationId: "runtime-events-generation-01",
      sequence: 43,
      workspaceId: "workspace_01",
      invalidation: {
        model: "commandInspector",
        ids: ["cmd_01"],
      },
    });
  });

  it("decodes reusable state invalidation descriptors without duplicating read models", () => {
    expect(
      decodeStateInvalidationDescriptor({
        scope: "workspace",
        workspaceId: "workspace_01",
        invalidation: {
          model: "commandInspector",
          ids: ["cmd_01"],
        },
      }) as unknown,
    ).toEqual({
      scope: "workspace",
      workspaceId: "workspace_01",
      invalidation: {
        model: "commandInspector",
        ids: ["cmd_01"],
      },
    });

    expect(
      decodeStateInvalidationDescriptor({
        scope: "app",
        invalidation: {
          model: "extensions",
          ids: ["ext_git"],
        },
      }) as unknown,
    ).toEqual({
      scope: "app",
      invalidation: {
        model: "extensions",
        ids: ["ext_git"],
      },
    });

    expect(() =>
      decodeStateInvalidationDescriptor({
        scope: "workspace",
        workspaceId: "workspace_01",
        invalidation: { model: "surface", ids: ["pi_handler_01"] },
        readModel: { rendererSnapshot: true },
      }),
    ).toThrow();
  });

  it("decodes runtime source invalidation requests without source previews", () => {
    expect(
      decodeSourceInvalidationHint({
        scope: { kind: "app-global" },
        domain: "extensions",
        path: "/tmp/svvy/extensions/web/index.ts",
        observedAt: "2026-06-19T08:00:00.000Z",
      }) as unknown,
    ).toEqual({
      scope: { kind: "app-global" },
      domain: "extensions",
      path: "/tmp/svvy/extensions/web/index.ts",
      observedAt: "2026-06-19T08:00:00.000Z",
    });

    expect(
      decodeSourceReconcileRequest({
        scope: { kind: "workspace", workspaceId: "workspace_01" },
        domains: ["external_instructions", "host_snippets"],
        reason: "watcher-debounce",
      }) as unknown,
    ).toEqual({
      scope: { kind: "workspace", workspaceId: "workspace_01" },
      domains: ["external_instructions", "host_snippets"],
      reason: "watcher-debounce",
    });

    expect(
      decodeSourceReconcileResult({
        changedReadModelCount: 1,
        generatedPackageRefreshes: [],
        recoveryWorkIds: [],
      }) as unknown,
    ).toEqual({
      changedReadModelCount: 1,
      generatedPackageRefreshes: [],
      recoveryWorkIds: [],
    });

    expect(() =>
      decodeSourceInvalidationHint({
        scope: { kind: "app-global" },
        domain: "external_instructions",
        path: "/tmp/repo/AGENTS.md",
      }),
    ).toThrow();
    expect(() =>
      decodeSourceInvalidationHint({
        scope: { kind: "workspace", workspaceId: "workspace_01" },
        domain: "extensions",
        path: "/tmp/svvy/extensions/web/index.ts",
      }),
    ).toThrow();
    expect(() =>
      decodeSourceReconcileRequest({
        scope: { kind: "app-global" },
        domains: ["extensions", "host_snippets"],
        reason: "manual",
      }),
    ).toThrow();
    expect(() =>
      decodeSourceReconcileRequest({
        scope: { kind: "workspace", workspaceId: "workspace_01" },
        domains: ["workflows"],
        reason: "manual",
      }),
    ).toThrow();

    expect(() =>
      decodeSourceInvalidationHint({
        scope: { kind: "app-global" },
        domain: "extensions",
        path: "/tmp/svvy/extensions/web/index.ts",
        textPreview: "renderer-owned draft text is not part of this hint",
      }),
    ).toThrow();
  });

  it("decodes explicit generated refresh requests through reusable core contracts", () => {
    expect(
      decodeRefreshGeneratedContextRequest({
        scope: "workspace",
        workspaceId: "workspace_01",
        reason: "extension-source-changed",
      }) as unknown,
    ).toEqual({
      scope: "workspace",
      workspaceId: "workspace_01",
      reason: "extension-source-changed",
    });

    expect(
      decodeRefreshGeneratedPackagesRequest({
        scope: "app-global",
        packages: ["@svvyx/extensions", "@svvyx/workflows"],
        reason: "source-changed",
        sourceCommandId: "cmd_generated_refresh_01",
        recoveryWorkId: "recovery_generated_refresh_01",
      }) as unknown,
    ).toEqual({
      scope: "app-global",
      packages: ["@svvyx/extensions", "@svvyx/workflows"],
      reason: "source-changed",
      sourceCommandId: "cmd_generated_refresh_01",
      recoveryWorkId: "recovery_generated_refresh_01",
    });

    expect(
      decodeRefreshGeneratedPackagesRequest({
        scope: "workspace-link-repair",
        workspaceId: "workspace_generated_link_repair_01",
        packages: ["@svvyx/extensions"],
        reason: "startup-recovery",
        sourceCommandId: "cmd_generated_link_01",
        recoveryWorkId: "recovery_generated_link_01",
      }) as unknown,
    ).toEqual({
      scope: "workspace-link-repair",
      workspaceId: "workspace_generated_link_repair_01",
      packages: ["@svvyx/extensions"],
      reason: "startup-recovery",
      sourceCommandId: "cmd_generated_link_01",
      recoveryWorkId: "recovery_generated_link_01",
    });

    expect(
      decodeGeneratedPackageBuildInput({
        packages: ["@svvyx/extensions"],
      }) as unknown,
    ).toEqual({
      packages: ["@svvyx/extensions"],
    });
    expect(() =>
      decodeGeneratedPackageBuildInput({
        packages: ["@svvyx/extensions"],
        scope: "app-global",
        reason: "source-changed",
        sourceCommandId: "cmd_generated_refresh_01",
        recoveryWorkId: "recovery_generated_refresh_01",
      }),
    ).toThrow();

    expect(
      decodeGeneratedPackagesRefreshResult({
        scope: "app-global",
        packages: [
          {
            packageName: "@svvyx/extensions",
            action: "written",
            diagnostics: [],
          },
        ],
        workspaceLinks: [],
        recoveryWorkIds: [],
      }) as unknown,
    ).toEqual({
      scope: "app-global",
      packages: [
        {
          packageName: "@svvyx/extensions",
          action: "written",
          diagnostics: [],
        },
      ],
      workspaceLinks: [],
      recoveryWorkIds: [],
    });

    expect(
      decodeGeneratedPackageBuildPlanResult({
        packages: [
          {
            packageName: "@svvyx/extensions",
            action: "written",
            manifestPath: "/tmp/svvy/generated/extensions/package.json",
            generatedFiles: [
              {
                relativePath: "index.ts",
                path: "/tmp/svvy/generated/extensions/index.ts",
              },
            ],
          },
        ],
      }) as unknown,
    ).toEqual({
      packages: [
        {
          packageName: "@svvyx/extensions",
          action: "written",
          manifestPath: "/tmp/svvy/generated/extensions/package.json",
          generatedFiles: [
            {
              relativePath: "index.ts",
              path: "/tmp/svvy/generated/extensions/index.ts",
            },
          ],
        },
      ],
    });

    expect(() =>
      decodeGeneratedPackageBuildPlanResult({
        packages: [],
        workspaceLinkRepairPlans: [],
      }),
    ).toThrow();

    expect(
      decodeGeneratedPackageWorkspaceLinkRepairInput({
        workspaceId: "workspace_01" as WorkspaceId,
        packageName: "@svvyx/extensions",
      }),
    ).toEqual({
      workspaceId: "workspace_01" as WorkspaceId,
      packageName: "@svvyx/extensions",
    });

    expect(() =>
      decodeRefreshGeneratedContextRequest({
        scope: "target",
        target: workflowTaskTarget,
        reason: "load-extension",
        generatedPromptPreview: "not a contract field",
      }),
    ).toThrow();
  });

  it("rejects surface stream events without target-local stream sequence cursors", () => {
    expect(() =>
      decodeRuntimeEvent({
        type: "surface.stream",
        workspaceId: "workspace_01",
        target: orchestratorTarget,
        sequence: 42,
        patch: {
          type: "assistant_text_delta",
          messageId: "msg_01",
          contentIndex: 0,
          delta: "Missing the per-surface stream cursor.",
        },
      }),
    ).toThrow();
  });

  it("decodes runtime event subscription inputs with app-event replay opt-in", () => {
    expect(
      decodeRuntimeEventsInput({
        workspaceId: "workspace_01",
        afterSequence: 120,
        includeAppEvents: true,
      }) as unknown,
    ).toEqual({
      workspaceId: "workspace_01",
      afterSequence: 120,
      includeAppEvents: true,
    });
    expect(
      Schema.decodeUnknownSync(RuntimeEventsInputSchema, {
        onExcessProperty: "error",
        errors: "all",
      })({
        workspaceSessionId: "wsess_01",
      }) as unknown,
    ).toEqual({ workspaceSessionId: "wsess_01" });
  });

  it("rejects renderer-only fields on runtime event subscriptions", () => {
    expect(() =>
      decodeRuntimeEventsInput({
        workspaceId: "workspace_01",
        afterSequence: 120,
        dockviewPanelId: "primary-transcript",
      }),
    ).toThrow();
  });

  it("decodes runtime event rebaseline errors with exact generation and read-model bounds", () => {
    const error = decodeRuntimeEventError({
      _tag: "RuntimeEventRebaselineRequired",
      reason: "stale-cursor",
      requestedAfterSequence: 12,
      retainedFromSequence: 40,
      currentHighWaterSequence: 96,
      eventGenerationId: "runtime-events-generation-01",
      affectedReadModels: [
        {
          scope: "workspace",
          workspaceId: "workspace_01",
          invalidation: { model: "surface", ids: ["surface_01"] },
        },
      ],
      workspaceId: "workspace_01",
      message: "Requested replay cursor is outside the retained event window.",
    });

    expect(error).toBeInstanceOf(RuntimeEventRebaselineRequired);
    expect(error).toEqual(
      new RuntimeEventRebaselineRequired({
        reason: "stale-cursor",
        requestedAfterSequence: 12 as RuntimeEventSequence,
        retainedFromSequence: 40 as RuntimeEventSequence,
        currentHighWaterSequence: 96 as RuntimeEventSequence,
        eventGenerationId: "runtime-events-generation-01" as RuntimeEventGenerationId,
        affectedReadModels: [
          {
            scope: "workspace",
            workspaceId: "workspace_01" as WorkspaceId,
            invalidation: { model: "surface", ids: ["surface_01" as SurfacePiSessionId] },
          },
        ],
        workspaceId: "workspace_01" as WorkspaceId,
        message: "Requested replay cursor is outside the retained event window.",
      }),
    );
  });

  it("decodes closed runtime facade errors without leaking foreign error objects", () => {
    expect(
      decodeRuntimeFacadeErrorContract({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "RuntimeContractError",
          operation: "Runtime.messages.submit",
          reason: "invalid-input",
          message: "Invalid submit request.",
        },
      }),
    ).toMatchObject({
      type: "runtime-facade-error",
      reason: "typed-failure",
      error: { _tag: "RuntimeContractError", reason: "invalid-input" },
    });

    expect(
      decodeRuntimeFacadeErrorContract({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "RuntimeEventRebaselineRequired",
          reason: "stale-cursor",
          requestedAfterSequence: 1,
          retainedFromSequence: 4,
          currentHighWaterSequence: 7,
          eventGenerationId: "runtime-events-generation-01",
          affectedReadModels: [],
          message: "Requested replay cursor is outside the retained event window.",
        },
      }),
    ).toMatchObject({
      type: "runtime-facade-error",
      reason: "typed-failure",
      error: { _tag: "RuntimeEventRebaselineRequired", reason: "stale-cursor" },
    });

    expect(
      decodeRuntimeFacadeErrorContract({
        type: "runtime-facade-error",
        reason: "defect",
        message: "Renderer bridge defect.",
        defectClass: "TypeError",
        diagnosticAppLogEntryId: "app-log-entry-01",
      }),
    ).toEqual({
      type: "runtime-facade-error",
      reason: "defect",
      message: "Renderer bridge defect.",
      defectClass: "TypeError",
      diagnosticAppLogEntryId: "app-log-entry-01" as AppLogEntryId,
    });

    expect(() =>
      decodeRuntimeFacadeErrorContract({
        type: "runtime-facade-error",
        reason: "defect",
        message: "Renderer bridge defect.",
        cause: new Error("raw cause"),
      }),
    ).toThrow();
  });

  it("decodes closed state facade errors without leaking state internals", () => {
    expect(
      decodeStateFacadeErrorContract({
        type: "state-facade-error",
        reason: "typed-failure",
        error: {
          _tag: "StateContractError",
          operation: "StateCommands.updatePreferences",
          reason: "stale-state",
          message: "State revision is stale.",
        },
      }),
    ).toMatchObject({
      type: "state-facade-error",
      reason: "typed-failure",
      error: { _tag: "StateContractError", reason: "stale-state" },
    });

    expect(
      decodeStateFacadeErrorContract({
        type: "state-facade-error",
        reason: "post-commit-notification-failed",
        receipt: {
          clientRequestId: "settings-save-01",
          outcome: "applied",
          committedAt: "2026-06-21T12:34:56.789Z",
          stateRevision: 42,
        },
        message: "Committed state, but notification publication failed.",
        diagnosticAppLogEntryId: "app-log-entry-01",
      }) as unknown,
    ).toEqual({
      type: "state-facade-error",
      reason: "post-commit-notification-failed",
      receipt: {
        clientRequestId: "settings-save-01",
        outcome: "applied",
        committedAt: "2026-06-21T12:34:56.789Z" as IsoDateTimeString,
        stateRevision: 42,
      },
      message: "Committed state, but notification publication failed.",
      diagnosticAppLogEntryId: "app-log-entry-01" as AppLogEntryId,
    });

    expect(
      Exit.isSuccess(
        decodeUnknownStateFacadeErrorContractExit({
          type: "state-facade-error",
          reason: "disposed",
        }),
      ),
    ).toBe(true);

    expect(() =>
      decodeStateFacadeErrorContract({
        type: "state-facade-error",
        reason: "defect",
        message: "State bridge defect.",
        cause: new Error("raw cause"),
      }),
    ).toThrow();
  });

  it("decodes cancelled turn notifications", () => {
    expect(
      decodeRuntimeEvent({
        type: "turn.changed",
        eventGenerationId: "runtime-events-generation-01",
        sequence: 44,
        workspaceId: "workspace_01",
        target: handlerTarget,
        turnId: "turn_01",
        status: "cancelled",
      }) as unknown,
    ).toEqual({
      type: "turn.changed",
      eventGenerationId: "runtime-events-generation-01",
      sequence: 44,
      workspaceId: "workspace_01",
      target: handlerTarget,
      turnId: "turn_01",
      status: "cancelled",
    });
  });

  it("decodes app-scoped and workspace-scoped recovery events without duplicated identity", () => {
    expect(
      decodeRuntimeEvent({
        type: "runtime.recovery",
        eventGenerationId: "runtime-events-generation-01",
        sequence: 50,
        scope: "workspace",
        workspaceId: "workspace_01",
        workId: "recovery_queue_01",
        status: "claimed",
      }) as unknown,
    ).toEqual({
      type: "runtime.recovery",
      eventGenerationId: "runtime-events-generation-01",
      sequence: 50,
      scope: "workspace",
      workspaceId: "workspace_01",
      workId: "recovery_queue_01",
      status: "claimed",
    });

    expect(
      decodeRuntimeEvent({
        type: "runtime.recovery",
        eventGenerationId: "runtime-events-generation-01",
        sequence: 51,
        scope: "app",
        workId: "recovery_generated_packages_01",
        status: "pending",
      }) as unknown,
    ).toEqual({
      type: "runtime.recovery",
      eventGenerationId: "runtime-events-generation-01",
      sequence: 51,
      scope: "app",
      workId: "recovery_generated_packages_01",
      status: "pending",
    });

    expect(() =>
      decodeRuntimeEvent({
        type: "runtime.recovery",
        eventGenerationId: "runtime-events-generation-01",
        sequence: 52,
        scope: "app",
        workspaceId: "workspace_01",
        workId: "recovery_generated_packages_01",
        status: "pending",
      }),
    ).toThrow();
  });

  it("decodes runtime dependency-action command requests and results", () => {
    expect(
      decodeRunExtensionDependencyActionInput({
        scope: {
          kind: "app-global",
          originWorkspaceId: "workspace_01",
        },
        extensionId: "web",
        requirementId: "tinyfish",
        action: "install",
        targetVersion: "0.1.6",
        clientSubmission: {
          source: "desktop",
          correlationId: "extension-requirement-row",
        },
      }) as unknown,
    ).toEqual({
      scope: {
        kind: "app-global",
        originWorkspaceId: "workspace_01",
      },
      extensionId: "web",
      requirementId: "tinyfish",
      action: "install",
      targetVersion: "0.1.6",
      clientSubmission: {
        source: "desktop",
        correlationId: "extension-requirement-row",
      },
    });

    expect(
      decodeRunExtensionDependencyActionResult({
        commandId: "cmd_dependency_01",
        status: "queued",
      }) as unknown,
    ).toEqual({
      commandId: "cmd_dependency_01",
      status: "queued",
    });
  });

  it("decodes runtime command cancellation requests without duplicating workspace state", () => {
    expect(
      decodeCancelCommandInput({
        commandId: "cmd_cancel_01",
        reason: "User clicked cancel.",
        clientSubmission: {
          source: "desktop",
          clientRequestId: "cancel-button",
        },
      }) as unknown,
    ).toEqual({
      commandId: "cmd_cancel_01",
      reason: "User clicked cancel.",
      clientSubmission: {
        source: "desktop",
        clientRequestId: "cancel-button",
      },
    });
  });

  it("decodes runtime approval answers without command previews or workspace snapshots", () => {
    expect(
      decodeAnswerRuntimeApprovalInput({
        approvalId: "approval_01",
        decision: "approved",
        reason: "Allowed by the user.",
        clientSubmission: {
          source: "runtime-approval-panel",
          clientRequestId: "approval-answer-01",
        },
      }) as unknown,
    ).toEqual({
      approvalId: "approval_01",
      decision: "approved",
      reason: "Allowed by the user.",
      clientSubmission: {
        source: "runtime-approval-panel",
        clientRequestId: "approval-answer-01",
      },
    });

    expect(
      decodeAnswerRuntimeApprovalResult({
        approvalId: "approval_01",
        commandId: "cmd_approval_01",
        status: "approved",
      }) as unknown,
    ).toEqual({
      approvalId: "approval_01",
      commandId: "cmd_approval_01",
      status: "approved",
    });

    expect(() =>
      decodeAnswerRuntimeApprovalInput({
        approvalId: "approval_01",
        approved: true,
      }),
    ).toThrow();

    expect(() =>
      decodeAnswerRuntimeApprovalResult({
        approvalId: "approval_01",
        commandId: "cmd_approval_01",
        status: "approved",
        commandPreview: "npm install",
        invalidations: [],
      }),
    ).toThrow();
  });

  it("decodes write-stdin command requests and results without shell command payloads", () => {
    expect(
      decodeWriteCommandStdinInput({
        commandId: "cmd_interactive_01",
        text: "y\n",
        clientSubmission: {
          source: "desktop",
          clientRequestId: "stdin-submit-01",
        },
      }) as unknown,
    ).toEqual({
      commandId: "cmd_interactive_01",
      text: "y\n",
      clientSubmission: {
        source: "desktop",
        clientRequestId: "stdin-submit-01",
      },
    });

    expect(
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
        status: "accepted",
        acceptedBytes: 2,
      }) as unknown,
    ).toEqual({
      commandId: "cmd_interactive_01",
      status: "accepted",
      acceptedBytes: 2,
    });

    for (const status of ["stdin_closed", "not_running", "already_terminal"] as const) {
      expect(
        decodeWriteCommandStdinResult({
          commandId: "cmd_interactive_01",
          status,
        }) as unknown,
      ).toEqual({
        commandId: "cmd_interactive_01",
        status,
      });
    }

    expect(() =>
      decodeWriteCommandStdinInput({
        commandId: "cmd_interactive_01",
        input: "y\n",
      }),
    ).toThrow();

    expect(() =>
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
      }),
    ).toThrow();

    expect(() =>
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
        status: "accepted",
      }),
    ).toThrow();

    expect(() =>
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
        status: "stdin_closed",
        acceptedBytes: 0,
      }),
    ).toThrow();

    expect(() =>
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
        status: "accepted",
        acceptedBytes: 1.5,
      }),
    ).toThrow();

    expect(() =>
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
        status: "accepted",
        acceptedBytes: -1,
      }),
    ).toThrow();

    expect(() =>
      decodeWriteCommandStdinResult({
        commandId: "cmd_interactive_01",
        status: "accepted",
        acceptedBytes: 2,
        invalidations: [],
      }),
    ).toThrow();
  });

  it("decodes prompt abort, queue steer, and submit result bridge contracts", () => {
    expect(
      decodeAbortPromptInput({
        target: handlerTarget,
        mode: "queued",
        queuedMessageId: "queue_abort_01",
        reason: "User clicked stop.",
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      mode: "queued",
      queuedMessageId: "queue_abort_01",
      reason: "User clicked stop.",
    });

    expect(
      decodeAbortPromptInput({
        target: handlerTarget,
        mode: "active-turn",
        turnId: "turn_abort_01",
        reason: "User clicked stop.",
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      mode: "active-turn",
      turnId: "turn_abort_01",
      reason: "User clicked stop.",
    });

    expect(
      decodeAbortPromptInput({
        target: handlerTarget,
        mode: "all-for-surface",
        reason: "User clicked stop.",
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      mode: "all-for-surface",
      reason: "User clicked stop.",
    });

    expect(
      decodeSteerQueuedMessageInput({
        target: handlerTarget,
        queuedMessageId: "queue_steer_01",
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      queuedMessageId: "queue_steer_01",
    });

    expect(
      decodeSubmitMessageResult({
        queuedMessageId: "queue_result_01",
        target: orchestratorTarget,
        status: "queued",
        receipt: {
          clientRequestId: "client-submit-01",
          outcome: "accepted",
          acceptedAt: "2026-04-18T09:00:00.000Z",
          stateRevision: 45,
        },
      }) as unknown,
    ).toEqual({
      queuedMessageId: "queue_result_01",
      target: orchestratorTarget,
      status: "queued",
      receipt: {
        clientRequestId: "client-submit-01",
        outcome: "accepted",
        acceptedAt: "2026-04-18T09:00:00.000Z",
        stateRevision: 45,
      },
    });

    expect(() =>
      decodeSubmitMessageResult({
        queuedMessageId: "queue_result_01",
        target: orchestratorTarget,
        status: "queued",
        receipt: {
          clientRequestId: "client-submit-01",
          outcome: "accepted",
          acceptedAt: "not-a-date",
          stateRevision: 45,
        },
      }),
    ).toThrow();
  });

  it("rejects renderer-only fields on prompt abort, queue steer, and submit result contracts", () => {
    expect(() =>
      decodeAbortPromptInput({
        target: handlerTarget,
        mode: "queued",
        queuedMessageId: "queue_abort_01",
        reason: "User clicked stop.",
        panelId: "handler-pane",
      }),
    ).toThrow();

    expect(() =>
      decodeAbortPromptInput({
        target: handlerTarget,
        queuedMessageId: "queue_abort_01",
        reason: "User clicked stop.",
      }),
    ).toThrow();

    expect(() =>
      decodeSteerQueuedMessageInput({
        target: handlerTarget,
        queuedMessageId: "queue_steer_01",
        delivery: "steer",
      }),
    ).toThrow();

    expect(() =>
      decodeSubmitMessageResult({
        queuedMessageId: "queue_result_01",
        target: orchestratorTarget,
        status: "queued",
        generatedPromptPreview: "not a runtime result",
      }),
    ).toThrow();

    expect(() =>
      decodeSubmitMessageResult({
        queuedMessageId: "queue_result_01",
        turnId: null,
        target: orchestratorTarget,
        status: "queued",
      }),
    ).toThrow();

    expect(() =>
      decodeSubmitMessageResult({
        queuedMessageId: "queue_result_02",
        turnId: "turn_result_02",
        target: orchestratorTarget,
        status: "running",
      }),
    ).toThrow();
  });

  it("rejects renderer-only fields on dependency-action command requests", () => {
    expect(() =>
      decodeRunExtensionDependencyActionInput({
        extensionId: "web",
        requirementId: "tinyfish",
        action: "install",
        targetVersion: "0.1.6",
        panelId: "extensions-pane-row",
      }),
    ).toThrow();
  });

  const runtimeEffectRequests = [
    {
      name: "atomic handler-thread start",
      request: {
        type: "handler_thread.start",
        input: {
          workspaceSessionId: "wsess_01",
          sourceCommandId: "cmd_thread_start_01",
          threads: [
            {
              objective:
                "Inspect the runtime event contract and report the smallest implementation change.",
              history: "forked",
              overrides: {
                shell: "loaded",
              },
              initialQueue: {
                priority: "runtime",
                notBefore: "2026-06-19T10:00:00.000Z",
              },
            },
          ],
        },
      },
    },
    {
      name: "handler-surface queue delivery",
      request: {
        type: "queue.insert",
        input: {
          target: handlerTarget,
          kind: "thread_followup",
          idempotencyKey: "thread_followup:cmd_01:thread_01",
          sourceCommandId: "cmd_01",
          priority: "runtime",
          payload: {
            kind: "thread_followup",
            threadIds: ["thread_01"],
            message: "Please rerun the focused verification.",
            sender: "orchestrator",
            activate: true,
          },
        },
      },
    },
    {
      name: "thread episode recording",
      request: {
        type: "episode.record",
        input: {
          scope: "handler-thread",
          workspaceSessionId: "wsess_01",
          threadId: "thread_01",
          threadGroupId: "thread_group_01",
          sourceCommandId: "cmd_01",
          kind: "conclusion",
          summary: "The runtime-effect contract needs full variant coverage.",
          body: "Validated queue delivery and generated-package refresh paths.",
          outcome: "completed",
          relatedArtifactIds: ["artifact_01"],
          relatedCommandIds: ["cmd_01", "cmd_02"],
          relatedWorkflowRunIds: ["wfr_01"],
          notifyOrchestrator: true,
        },
      },
    },
    {
      name: "request-input creation",
      request: {
        type: "request_input.create",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_request_01",
          mode: "blocking",
          timeout: {
            enabled: true,
            durationMs: 120000,
          },
          questions: [
            {
              title: "Verification scope",
              question: "Which verification should run before handoff?",
              options: [
                {
                  label: "Focused tests",
                  description: "Run the package contract tests only.",
                  recommended: true,
                },
                {
                  label: "Full check",
                  description: "Run the normal repository preflight.",
                },
              ],
            },
          ],
        },
      },
    },
    {
      name: "generated context refresh",
      request: {
        type: "generated_context.refresh",
        input: {
          scope: "target",
          target: orchestratorTarget,
          actorKind: "orchestrator",
          reason: "profile-settings-changed",
          sourceCommandId: "cmd_load_extension_01",
          refreshBoundSurfaceBeforeNextTurn: true,
        },
      },
    },
    {
      name: "generated package refresh",
      request: {
        type: "generated_packages.refresh",
        input: {
          scope: "workspace-link-repair",
          workspaceId: "workspace_01",
          packages: ["@svvyx/workflows", "@svvyx/extensions"],
          reason: "explicit-build",
          sourceCommandId: "cmd_load_extension_01",
        },
      },
    },
  ] as const;

  for (const { name, request } of runtimeEffectRequests) {
    it(`decodes runtime effect requests for ${name}`, () => {
      expect(unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap(request) as unknown).toEqual(
        request,
      );
    });
  }

  it("decodes trusted svvyx runtime-effect transport context-impact intents", () => {
    const usage = decodeUnknownSvvyxRuntimeEffectTransportIntentExit({
      id: "runtime-effect-1",
      kind: "runtime_effect.request",
      request: {
        type: "extension_usage.context_impact",
        target: "extension_usage",
        input: {
          agentProfile: "default-orchestrator",
          profileId: "profile_default_orchestrator",
        },
      },
    });
    expect(Exit.isSuccess(usage)).toBe(true);

    const snapshot = decodeUnknownSvvyxRuntimeEffectTransportIntentExit({
      id: "runtime-effect-2",
      kind: "runtime_effect.request",
      request: {
        type: "extension_snapshot.context_impact",
        target: "snapshot_load",
        input: {
          affectedExtensionIds: ["smithers"],
          affectedUsageProfiles: ["orchestrator:default-orchestrator", "handler:threadHandler"],
          removedUserExtensionIds: ["legacy-extension"],
        },
      },
    });
    expect(Exit.isSuccess(snapshot)).toBe(true);
  });

  it("rejects malformed svvyx runtime-effect transport context-impact intents", () => {
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxRuntimeEffectTransportIntentExit({
          id: "runtime-effect-1",
          kind: "runtime_effect.request",
          request: {
            type: "extension_usage.context_impact",
            target: "snapshot_load",
            input: {
              agentProfile: "default-orchestrator",
              profileId: "profile_default_orchestrator",
            },
          },
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeUnknownSvvyxRuntimeEffectTransportIntentExit({
          id: "runtime-effect-2",
          kind: "runtime_effect.request",
          request: {
            type: "extension_snapshot.context_impact",
            target: "snapshot_load",
            input: {
              affectedExtensionIds: ["smithers"],
              affectedUsageProfiles: ["handler:wrong"],
              removedUserExtensionIds: [],
            },
          },
        }),
      ),
    ).toBe(true);
  });

  it("rejects split surface creation effects from extension runtime requests", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "surface.create",
        input: {
          workspaceSessionId: "wsess_01",
          surface: "handler",
          threadId: "thread_01",
          actorProfileId: "profile_handler_01",
        },
      }),
    ).toThrow();
  });

  it("rejects extension-authored runtime approval requests", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "approval.request",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_exec_01",
          approvalKind: "shell",
          title: "Run repository check",
          reason: "The command needs approval before execution.",
          commandPreview: "bun run check",
        },
      }),
    ).toThrow();
  });

  it("rejects empty atomic handler-thread start requests", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "handler_thread.start",
        input: {
          workspaceSessionId: "wsess_01",
          sourceCommandId: "cmd_thread_start_01",
          threads: [],
        },
      }),
    ).toThrow();
  });

  it("rejects caller-selected handler actor profiles on handler-thread start requests", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "handler_thread.start",
        input: {
          workspaceSessionId: "wsess_01",
          sourceCommandId: "cmd_thread_start_01",
          threads: [
            {
              objective: "Investigate the issue",
              actorProfileId: "profile_handler_custom",
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects caller-provided workspace identity on episode recording effects", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "episode.record",
        input: {
          scope: "handler-thread",
          workspaceId: "workspace_01",
          workspaceSessionId: "wsess_01",
          threadId: "thread_01",
          threadGroupId: "thread_group_01",
          kind: "report",
          summary: "This should derive workspace identity in runtime.",
        },
      }),
    ).toThrow();
  });

  it("rejects orchestrator-local episode recording effects without a product state model", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "episode.record",
        input: {
          scope: "orchestrator-local",
          workspaceSessionId: "wsess_01",
          target: orchestratorTarget,
          kind: "report",
          summary: "This branch must not decode until state owns non-thread episodes.",
        },
      }),
    ).toThrow();
  });

  it("rejects workflow-task targets on actor extension binding update effects", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "actor_extension_binding.update",
        input: {
          target: {
            workspaceSessionId: "wsess_01",
            surface: "workflow-task",
            surfacePiSessionId: "pi_workflow_task_01",
            threadId: "thread_01",
            workflowTaskAttemptId: "workflow_task_attempt_01",
          },
          extensionId: "smithers",
          usage: "loaded",
          reason: "load_extension",
          sourceCommandId: "cmd_load_extension_01",
        },
      }),
    ).toThrow();
  });

  for (const kind of [
    "initial_handler_start",
    "thread_followup",
    "report_request",
    "thread_report_notification",
    "request_user_input_answer",
    "workflow_task_agent_start",
  ] as const) {
    it(`decodes queue insert requests with ${kind} queue kind`, () => {
      const payload = {
        kind,
        ...(kind === "initial_handler_start"
          ? {
              threadId: "thread_01",
              threadGroupId: "thread_group_01",
              objective: "Review the runtime contracts.",
            }
          : kind === "thread_followup"
            ? {
                threadIds: ["thread_01"],
                message: "Please rerun the focused verification.",
                sender: "orchestrator",
              }
            : kind === "report_request"
              ? {
                  threadId: "thread_01",
                  reason: "Status needed before handoff.",
                  expectedEpisodeKind: "report",
                }
              : kind === "thread_report_notification"
                ? {
                    sourceThreadId: "thread_01",
                    episodeId: "episode_01",
                    notificationKind: "update",
                  }
                : kind === "request_user_input_answer"
                  ? {
                      requestId: "rui_01",
                      questionId: "ruiq_01",
                      answerId: "ruia_01",
                      delivery: "enqueue-and-run",
                    }
                  : {
                      workflowTaskAttemptId: "wfta_01",
                      taskIdentity: {
                        runId: "workflow_run_01",
                        nodeId: "task_review",
                        iteration: 0,
                        attempt: 1,
                      },
                      smithersContext: {
                        rootDir: "/repo",
                      },
                      agent: {
                        id: "reviewer",
                        label: "Reviewer",
                        provider: "openai",
                        model: "gpt-5.4",
                        reasoning: { effort: "high" },
                        instructions: "Review the focused implementation.",
                      },
                      promptSource: {
                        kind: "messages",
                        messages: [
                          {
                            role: "user",
                            text: "Focus on queue semantics.",
                          },
                        ],
                      },
                    }),
      } as const;
      const request = {
        type: "queue.insert",
        input: {
          target:
            kind === "workflow_task_agent_start"
              ? workflowTaskTarget
              : kind === "thread_report_notification"
                ? orchestratorTarget
                : handlerTarget,
          kind,
          payload,
          idempotencyKey: `queue:${kind}:01`,
          ...(kind === "workflow_task_agent_start" || kind === "thread_report_notification"
            ? { sourceCommandId: "cmd_workflow_task_01" }
            : {}),
        },
      } as const;
      expect(unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap(request) as unknown).toEqual(
        request,
      );
    });
  }

  it("rejects the old user_prompt queue kind", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: handlerTarget,
          kind: "user_prompt",
          payload: {
            kind: "user_message",
            message: { text: "Old queue kind" },
          },
          idempotencyKey: "old:queue:kind",
        },
      }),
    ).toThrow();
  });

  it("rejects extension-authored ordinary user-message queue rows", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: orchestratorTarget,
          kind: "user_message",
          payload: {
            kind: "user_message",
            message: { text: "This must be submitted through runtime message submission." },
          },
          idempotencyKey: "extension:user-message:01",
        },
      }),
    ).toThrow();
  });

  it("rejects queue insert requests whose kind does not match the target surface kind", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: orchestratorTarget,
          kind: "initial_handler_start",
          payload: {
            kind: "initial_handler_start",
            threadId: "thread_01",
            threadGroupId: "thread_group_01",
            objective: "This must target a handler surface.",
          },
          idempotencyKey: "orchestrator:initial-handler-start:01",
        },
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: handlerTarget,
          kind: "thread_report_notification",
          payload: {
            kind: "thread_report_notification",
            sourceThreadId: "thread_01",
            episodeId: "episode_01",
            notificationKind: "update",
          },
          idempotencyKey: "handler:thread-report-notification:01",
        },
      }),
    ).toThrow();
  });

  it("rejects workflow task-agent queue rows without source command lineage", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: workflowTaskTarget,
          kind: "workflow_task_agent_start",
          payload: {
            kind: "workflow_task_agent_start",
            workflowTaskAttemptId: "wfta_01",
            taskIdentity: {
              runId: "workflow_run_01",
              nodeId: "task_review",
              iteration: 0,
              attempt: 1,
            },
            agent: {
              id: "reviewer",
              label: "Reviewer",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "high" },
              instructions: "Review the focused implementation.",
            },
            promptSource: {
              kind: "prompt",
              prompt: "Review this.",
            },
          },
          idempotencyKey: "workflow-task:missing-source-command",
        },
      }),
    ).toThrow();
  });

  it("rejects obsolete workflow task-agent queue payload prompt fields", () => {
    const basePayload = {
      kind: "workflow_task_agent_start",
      workflowTaskAttemptId: "wfta_01",
      taskIdentity: {
        runId: "workflow_run_01",
        nodeId: "task_review",
        iteration: 0,
        attempt: 1,
      },
      agent: {
        id: "reviewer",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "high" },
        instructions: "Review the focused implementation.",
      },
      promptSource: {
        kind: "prompt",
        prompt: "Review this.",
      },
    } as const;

    for (const extraPayload of [
      { prompt: "Review this." },
      { messages: [{ role: "user", text: "Review this." }] },
      { rootDir: "/repo" },
      { taskContext: basePayload.taskIdentity },
    ]) {
      expect(() =>
        unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
          type: "queue.insert",
          input: {
            target: workflowTaskTarget,
            kind: "workflow_task_agent_start",
            sourceCommandId: "cmd_workflow_task_01",
            payload: {
              ...basePayload,
              ...extraPayload,
            },
            idempotencyKey: "workflow-task:obsolete-payload-fields",
          },
        }),
      ).toThrow();
    }
  });

  it("rejects thread report notifications without source command lineage", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: orchestratorTarget,
          kind: "thread_report_notification",
          payload: {
            kind: "thread_report_notification",
            sourceThreadId: "thread_01",
            episodeId: "episode_01",
            notificationKind: "update",
          },
          idempotencyKey: "thread-report-notification:missing-source-command",
        },
      }),
    ).toThrow();
  });

  it("rejects removed batch fields on request-input answer queue payloads", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: handlerTarget,
          kind: "request_user_input_answer",
          payload: {
            kind: "request_user_input_answer",
            answer: {
              requestId: "rui_01",
              answerId: "ruia_01",
              questionAnswers: [
                {
                  questionId: "ruiq_01",
                  selectedOptionIds: ["ruio_01"],
                },
              ],
              answeredAt: "2026-06-18T00:00:00.000Z",
            },
            answeredBy: "user",
          },
          idempotencyKey: "request-input-answer:confirmation:01",
        },
      }),
    ).toThrow();
  });

  it("decodes request-input answer queue and agent delivery payloads without duplicated state", () => {
    expect(
      decodeRequestUserInputAnswerQueuePayload({
        kind: "request_user_input_answer",
        requestId: "rui_01",
        questionId: "ruiq_01",
        answerId: "ruia_01",
        delivery: "queue-only",
      }) as unknown,
    ).toEqual({
      kind: "request_user_input_answer",
      requestId: "rui_01",
      questionId: "ruiq_01",
      answerId: "ruia_01",
      delivery: "queue-only",
    });

    expect(
      decodeRequestUserInputAnswerDeliveryPayload({
        type: "request_user_input.answer",
        title: "CI scope",
        question: "Should CI run only unit checks or the full suite?",
        originalAnswer: {
          kind: "option",
          label: "Unit checks",
          text: "Unit checks",
        },
        userAnswer: {
          kind: "custom",
          text: "Run the full suite.",
        },
      }) as unknown,
    ).toEqual({
      type: "request_user_input.answer",
      title: "CI scope",
      question: "Should CI run only unit checks or the full suite?",
      originalAnswer: {
        kind: "option",
        label: "Unit checks",
        text: "Unit checks",
      },
      userAnswer: {
        kind: "custom",
        text: "Run the full suite.",
      },
    });
  });

  it("rejects internal ids and metadata on request-input answer delivery payloads", () => {
    expect(() =>
      decodeRequestUserInputAnswerDeliveryPayload({
        type: "request_user_input.answer",
        title: "CI scope",
        question: "Should CI run only unit checks or the full suite?",
        requestId: "rui_01",
        originalAnswer: {
          kind: "option",
          label: "Unit checks",
          text: "Unit checks",
        },
        userAnswer: {
          kind: "custom",
          text: "Run the full suite.",
        },
      }),
    ).toThrow();
  });

  it("rejects system-role workflow task-agent bridge messages", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.insert",
        input: {
          target: workflowTaskTarget,
          kind: "workflow_task_agent_start",
          sourceCommandId: "cmd_workflow_task_01",
          payload: {
            kind: "workflow_task_agent_start",
            workflowTaskAttemptId: "wfta_01",
            taskIdentity: {
              runId: "workflow_run_01",
              nodeId: "task_review",
              iteration: 0,
              attempt: 1,
            },
            agent: {
              id: "reviewer",
              label: "Reviewer",
              provider: "openai",
              model: "gpt-5.4",
              reasoning: { effort: "high" },
              instructions: "Review the focused implementation.",
            },
            promptSource: {
              kind: "messages",
              messages: [{ role: "system", text: "Hidden system content." }],
            },
          },
          idempotencyKey: "workflow-task:system-message",
        },
      }),
    ).toThrow();
  });

  it("rejects renderer-local fields inside runtime effect requests", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "generated_context.refresh",
        input: {
          scope: "target",
          target: {
            ...orchestratorTarget,
            panelId: "dock-panel-01",
          },
          reason: "profile-settings-changed",
          refreshBoundSurfaceBeforeNextTurn: true,
        },
      }),
    ).toThrow();
  });

  it("rejects ambiguous generated-context refresh requests with both workspace and target identity", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "generated_context.refresh",
        input: {
          workspaceId: "workspace_01",
          target: orchestratorTarget,
          actorKind: "orchestrator",
          reason: "profile-settings-changed",
          refreshBoundSurfaceBeforeNextTurn: true,
        },
      }),
    ).toThrow();
  });

  it("rejects request-input creation questions with renderer-local generated answers", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "request_input.create",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_request_01",
          mode: "nonblocking",
          questions: [
            {
              title: "Verification scope",
              question: "Which verification should run before handoff?",
              defaultAnswer: {
                kind: "option",
                optionId: "ruio_01",
              },
              options: [
                {
                  label: "Focused tests",
                  description: "Run the package contract tests only.",
                  recommended: true,
                },
                {
                  label: "Full check",
                  description: "Run the normal repository preflight.",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("decodes direct request-input creation requests with structural question variants", () => {
    expect(
      decodeCreateRequestInputRequest({
        target: handlerTarget,
        sourceCommandId: "cmd_request_01",
        mode: "blocking",
        timeout: {
          enabled: true,
          durationMs: 300000,
        },
        questions: [
          {
            title: "Verification scope",
            question: "Which verification should run before handoff?",
            options: [
              {
                label: "Focused tests",
                description: "Run the package contract tests only.",
                recommended: true,
              },
              {
                label: "Full check",
                description: "Run the normal repository preflight.",
              },
            ],
          },
          {
            title: "Release note tone",
            question: "What release-note tone should I use?",
            defaultAnswer: "Concise engineering summary focused on user-visible changes.",
          },
        ],
      }) as unknown,
    ).toEqual({
      target: handlerTarget,
      sourceCommandId: "cmd_request_01",
      mode: "blocking",
      timeout: {
        enabled: true,
        durationMs: 300000,
      },
      questions: [
        {
          title: "Verification scope",
          question: "Which verification should run before handoff?",
          options: [
            {
              label: "Focused tests",
              description: "Run the package contract tests only.",
              recommended: true,
            },
            {
              label: "Full check",
              description: "Run the normal repository preflight.",
            },
          ],
        },
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          defaultAnswer: "Concise engineering summary focused on user-visible changes.",
        },
      ],
    });
  });

  it("rejects request-input creation requests with explicit undefined timeout", () => {
    expect(() =>
      decodeCreateRequestInputRequest({
        target: handlerTarget,
        sourceCommandId: "cmd_request_01",
        mode: "blocking",
        timeout: undefined,
        questions: [
          {
            title: "Verification scope",
            question: "Which verification should run before handoff?",
            options: [
              {
                label: "Focused tests",
                description: "Run the package contract tests only.",
                recommended: true,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects request-input creation questions with caller-provided generated ids", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "request_input.create",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_request_01",
          mode: "nonblocking",
          questions: [
            {
              questionId: "ruiq_01",
              title: "Verification scope",
              question: "Which verification should run before handoff?",
              options: [
                {
                  optionId: "ruio_01",
                  label: "Focused tests",
                  description: "Run the package contract tests only.",
                  recommended: true,
                },
                {
                  label: "Full check",
                  description: "Run the normal repository preflight.",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects removed request-input creation question field names and kind tags", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "request_input.create",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_request_01",
          mode: "nonblocking",
          questions: [
            {
              header: "Confirmation",
              prompt: "Proceed?",
              inputKind: "confirmation",
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects request-input choice questions without exactly one recommended option", () => {
    const baseInput = {
      type: "request_input.create",
      input: {
        target: handlerTarget,
        sourceCommandId: "cmd_request_01",
        mode: "nonblocking",
        questions: [
          {
            title: "Verification scope",
            question: "Which verification should run before handoff?",
            options: [
              {
                label: "Focused tests",
                description: "Run the package contract tests only.",
              },
              {
                label: "Full check",
                description: "Run the normal repository preflight.",
              },
            ],
          },
        ],
      },
    } as const;

    expect(() => unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap(baseInput)).toThrow();
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        ...baseInput,
        input: {
          ...baseInput.input,
          questions: [
            {
              ...baseInput.input.questions[0],
              options: baseInput.input.questions[0].options.map((option) => ({
                ...option,
                recommended: true,
              })),
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects request-input choice options with explicit false recommendation flags", () => {
    expect(() =>
      decodeCreateRequestInputRequest({
        target: handlerTarget,
        sourceCommandId: "cmd_request_01",
        mode: "nonblocking",
        questions: [
          {
            title: "Verification scope",
            question: "Which verification should run before handoff?",
            options: [
              {
                label: "Focused tests",
                description: "Run the package contract tests only.",
                recommended: true,
              },
              {
                label: "Full check",
                description: "Run the normal repository preflight.",
                recommended: false,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects request-input questions that mix or omit structural variants", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "request_input.create",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_request_01",
          mode: "nonblocking",
          questions: [
            {
              title: "Verification scope",
              question: "Which verification should run before handoff?",
              defaultAnswer: "Focused tests.",
              options: [
                {
                  label: "Focused tests",
                  description: "Run the package contract tests only.",
                  recommended: true,
                },
                {
                  label: "Full check",
                  description: "Run the normal repository preflight.",
                },
              ],
            },
          ],
        },
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "request_input.create",
        input: {
          target: handlerTarget,
          sourceCommandId: "cmd_request_01",
          mode: "nonblocking",
          questions: [
            {
              title: "Verification scope",
              question: "Which verification should run before handoff?",
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("rejects generated package refresh requests outside the generated package allowlist", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "generated_packages.refresh",
        input: {
          scope: "workspace-link-repair",
          workspaceId: "workspace_01",
          packages: ["@svvyx/workflows", "@svvy/runtime"],
          reason: "explicit-build",
        },
      }),
    ).toThrow();
  });

  it("rejects generated package refresh link repair without workspace scope", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "generated_packages.refresh",
        input: {
          scope: "app-global",
          packages: ["@svvyx/workflows"],
          reason: "link-repair",
        },
      }),
    ).toThrow();
  });

  it("rejects unknown runtime effect request variants", () => {
    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "desktop.openPane",
        input: {
          panelId: "primary",
        },
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeRuntimeEffectRequestSyncForTestsAndBootstrap({
        type: "queue.steer",
        input: {
          target: handlerTarget,
          queuedMessageId: "queue_7f2",
        },
      }),
    ).toThrow();
  });

  it("rejects command result envelope fields that are not part of the stable contract", () => {
    expect(() =>
      decodeCommandResultEnvelope({
        stdout: "created artifact_01",
        summary: "Created the evidence artifact.",
        commandFacts: {
          kind: "artifact.created",
          artifactId: "artifact_01",
        },
        outputControl: {
          mode: "artifact",
        },
      }),
    ).toThrow();

    expect(() =>
      decodeCommandResultEnvelope({
        stderr: "full stderr belongs in command output events",
      }),
    ).toThrow();
  });

  it("rejects invalid command fact envelopes", () => {
    expect(() =>
      decodeCommandResultEnvelope({
        status: "succeeded",
        commandFacts: "artifact.created",
      }),
    ).toThrow();
  });

  it("decodes native tool results with optional command details", () => {
    expect(
      decodeNativeToolResult({
        content: [{ type: "text", text: "Created artifact_01" }],
      }),
    ).toEqual({
      content: [{ type: "text", text: "Created artifact_01" }],
    });

    expect(
      decodeNativeToolResult({
        content: [{ type: "text", text: "Created artifact_01" }],
        details: {
          status: "succeeded",
          summary: "Created the evidence artifact.",
          commandFacts: {
            kind: "artifact.created",
            artifactId: "artifact_01",
          },
        },
      }),
    ).toEqual({
      content: [{ type: "text", text: "Created artifact_01" }],
      details: {
        status: "succeeded",
        summary: "Created the evidence artifact.",
        commandFacts: {
          kind: "artifact.created",
          artifactId: "artifact_01",
        },
      },
    });

    expect(() =>
      decodeNativeToolResult({
        content: [{ type: "text", text: "Created artifact_01" }],
        details: {
          status: "succeeded",
          stdout: "full stdout belongs in command output events",
        },
      }),
    ).toThrow();

    expect(() =>
      decodeNativeToolResult({
        content: [{ type: "text", text: "Created artifact_01" }],
        details: {
          status: "succeeded",
          extra: "unknown details fields are invalid",
        },
      }),
    ).toThrow();
  });

  it("decodes extension handler results with ordered runtime operations", () => {
    const queueInsertRequest = {
      type: "queue.insert",
      input: {
        target: handlerTarget,
        kind: "thread_followup",
        idempotencyKey: "thread_followup:cmd_followup_01:thread_01",
        sourceCommandId: "cmd_followup_01",
        priority: "runtime",
        payload: {
          kind: "thread_followup",
          threadIds: ["thread_01"],
          message: "Continue from the reported issue.",
          sender: "orchestrator",
          activate: true,
        },
      },
    } as const;

    expect(
      decodeExtensionHandlerResult({
        result: {
          content: [{ type: "text", text: "Queued handler follow-up." }],
          details: {
            status: "succeeded",
            summary: "Queued a handler follow-up.",
          },
        },
        operations: [
          {
            kind: "runtime_effect",
            request: queueInsertRequest,
          },
          {
            kind: "execution_plan",
            plan: childProcessExecutionPlan,
          },
        ],
      }) as unknown,
    ).toEqual({
      result: {
        content: [{ type: "text", text: "Queued handler follow-up." }],
        details: {
          status: "succeeded",
          summary: "Queued a handler follow-up.",
        },
      },
      operations: [
        {
          kind: "runtime_effect",
          request: queueInsertRequest,
        },
        {
          kind: "execution_plan",
          plan: childProcessExecutionPlan,
        },
      ],
    });

    for (const [field, value] of [
      [
        "runtimeEffects",
        [
          {
            type: "queue.insert",
            input: {
              target: handlerTarget,
              kind: "thread_followup",
              idempotencyKey: "thread_followup:cmd_followup_01:thread_01",
              priority: "runtime",
              payload: {
                kind: "thread_followup",
                threadIds: ["thread_01"],
                message: "Continue from the reported issue.",
                sender: "orchestrator",
              },
            },
          },
        ],
      ],
      ["executionPlans", [childProcessExecutionPlan]],
      ["mutateStateDirectly", true],
      ["stateWrites", []],
      ["runtimeEvents", []],
      ["finishCommand", true],
      ["generatedPackageFacts", []],
      ["workspaceLinkWrites", []],
    ] as const) {
      expect(() =>
        decodeExtensionHandlerResult({
          result: {
            details: { status: "succeeded" },
          },
          [field]: value,
        }),
      ).toThrow();
    }

    for (const operations of [
      [queueInsertRequest],
      [childProcessExecutionPlan],
      [{ kind: "unknown", request: queueInsertRequest }],
    ]) {
      expect(() =>
        decodeExtensionHandlerResult({
          result: {
            details: { status: "succeeded" },
          },
          operations,
        }),
      ).toThrow();
    }
  });

  it("decodes immutable extension execution plans for runtime-owned work", () => {
    expect(decodeExtensionExecutionPlan(childProcessExecutionPlan) as unknown).toEqual(
      childProcessExecutionPlan,
    );
    expect(decodeExtensionExecutionPlan(applyPatchExecutionPlan) as unknown).toEqual(
      applyPatchExecutionPlan,
    );

    const success = decodeExtensionExecutionPlanExit(childProcessExecutionPlan);
    expect(Exit.isSuccess(success)).toBe(true);
    expect(
      Exit.isFailure(
        decodeExtensionExecutionPlanExit({
          type: "extension_dependency.action",
          planId: "plan_dependency_01",
        }),
      ),
    ).toBe(true);
  });

  it("rejects execution plans that contain runtime-owned handles or raw secrets", () => {
    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        commandId: "cmd_01",
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        processHandle: 123,
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        callback: "run-after-launch",
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        command: {
          ...childProcessExecutionPlan.command,
          display: "bun test",
        },
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        sandbox: "use-command-snapshot",
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...applyPatchExecutionPlan,
        output: {
          facts: "apply_patch.finished",
        },
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        env: {
          ...extensionExecutionEnvPlan,
          secretValues: {
            GITHUB_TOKEN: "raw-token",
          },
        },
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        env: {
          GITHUB_TOKEN: "raw-token",
        },
      }),
    ).toThrow();
  });

  it("rejects execution plans with empty command or patch payloads", () => {
    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        command: {
          ...childProcessExecutionPlan.command,
          argv: [],
        },
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...childProcessExecutionPlan,
        command: {
          ...childProcessExecutionPlan.command,
          argv: [""],
        },
      }),
    ).toThrow();

    expect(() =>
      decodeExtensionExecutionPlan({
        ...applyPatchExecutionPlan,
        patch: "",
      }),
    ).toThrow();
  });

  it("decodes workflow task-agent bridge requests as the canonical runtime DTO", () => {
    const decodedRequest: unknown = unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap({
      operation: "runTaskAgent",
      bridgeRequestId: "bridge-request-1",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review carefully.",
        overrides: { shell: "available" },
      },
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 2,
        attempt: 1,
      },
      smithersContext: {
        run: { id: "smithers-run-1" },
        node: { id: "node-review" },
        rootDir: "/workspace/project",
      },
      promptSource: {
        kind: "messages",
        messages: [{ role: "user", text: "Review this." }],
      },
    });

    expect(decodedRequest).toEqual({
      operation: "runTaskAgent",
      bridgeRequestId: "bridge-request-1",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review carefully.",
        overrides: { shell: "available" },
      },
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 2,
        attempt: 1,
      },
      smithersContext: {
        run: { id: "smithers-run-1" },
        node: { id: "node-review" },
        rootDir: "/workspace/project",
      },
      promptSource: {
        kind: "messages",
        messages: [{ role: "user", text: "Review this." }],
      },
    });

    expect(
      unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap({
        operation: "runTaskAgent",
        workspaceSessionId: "workspace-session-1",
        sourceCommandId: "command-1",
        agent: {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review carefully.",
        },
        taskIdentity: {
          runId: "smithers-run-1",
          nodeId: "node-review",
          iteration: 0,
          attempt: 0,
        },
        promptSource: {
          kind: "prompt",
          prompt: "Review this.",
        },
      }).promptSource,
    ).toEqual({
      kind: "prompt",
      prompt: "Review this.",
    });
  });

  it("decodes workflow task-agent bridge source requests without branded ids", () => {
    const decodedRequest: unknown = unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap({
      operation: "runTaskAgent",
      bridgeRequestId: "bridge-request-1",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review carefully.",
      },
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 2,
        attempt: 1,
      },
      smithersContext: {
        rootDir: "smithers-relative-or-host-provided-source",
      },
      promptSource: {
        kind: "prompt",
        prompt: "Review this.",
      },
    });

    expect(decodedRequest).toEqual({
      operation: "runTaskAgent",
      bridgeRequestId: "bridge-request-1",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review carefully.",
      },
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 2,
        attempt: 1,
      },
      smithersContext: {
        rootDir: "smithers-relative-or-host-provided-source",
      },
      promptSource: {
        kind: "prompt",
        prompt: "Review this.",
      },
    });
  });

  it("rejects workflow task-agent bridge source requests with explicit undefined bridge request id", () => {
    expect(() =>
      unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap({
        operation: "runTaskAgent",
        bridgeRequestId: undefined,
        workspaceSessionId: "workspace-session-1",
        sourceCommandId: "command-1",
        agent: {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review carefully.",
        },
        taskIdentity: {
          runId: "smithers-run-1",
          nodeId: "node-review",
          iteration: 2,
          attempt: 1,
        },
        promptSource: {
          kind: "prompt",
          prompt: "Review this.",
        },
      }),
    ).toThrow();
  });

  it("decodes authenticated workflow task-agent bridge inputs separately from request DTOs", () => {
    const request = {
      operation: "runTaskAgent",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review carefully.",
      },
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 0,
        attempt: 0,
      },
      promptSource: {
        kind: "prompt",
        prompt: "Review this.",
      },
    } as const;

    expect(
      decodeAuthenticatedRunTaskAgentInput({
        auth: {
          kind: "bearer",
          token: "bridge-token-1",
          transport: "loopback-http",
        },
        request,
      }) as unknown,
    ).toEqual({
      auth: {
        kind: "bearer",
        token: "bridge-token-1",
        transport: "loopback-http",
      },
      request,
    });

    expect(() =>
      decodeAuthenticatedRunTaskAgentInput({
        auth: {
          kind: "bearer",
          token: "",
          transport: "loopback-http",
        },
        request,
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap({
        ...request,
        auth: {
          kind: "bearer",
          token: "bridge-token-1",
          transport: "loopback-http",
        },
      }),
    ).toThrow();
  });

  it("rejects obsolete workflow task-agent bridge request fields", () => {
    expect(() =>
      unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap({
        operation: "runTaskAgent",
        workspaceSessionId: "workspace-session-1",
        sourceCommandId: "command-1",
        agent: {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review carefully.",
        },
        smithersRunId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 0,
        attempt: 0,
        prompt: "Review this.",
      }),
    ).toThrow();

    expect(() =>
      unsafeDecodeRunTaskAgentInputSyncForTestsAndBootstrap({
        operation: "runTaskAgent",
        workspaceSessionId: "workspace-session-1",
        sourceCommandId: "command-1",
        agent: {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review carefully.",
        },
        taskIdentity: {
          runId: "smithers-run-1",
          nodeId: "node-review",
          iteration: 0,
          attempt: 0,
        },
        promptSource: {
          kind: "messages",
          messages: [{ role: "system", text: "Hidden system instruction." }],
        },
      }),
    ).toThrow();
  });

  it("rejects runtime-owned workflow task-agent bridge source fields", () => {
    const sourceRequest = {
      operation: "runTaskAgent",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      agent: {
        id: "reviewerAgent",
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoning: { effort: "medium" },
        instructions: "Review carefully.",
      },
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 0,
        attempt: 0,
      },
      promptSource: {
        kind: "prompt",
        prompt: "Review this.",
      },
    } as const;

    const runtimeOwnedFields: Record<string, unknown> = {
      workspaceId: "workspace-1",
      surfacePiSessionId: "pi-session-1",
      workflowTaskAttemptId: "workflow-task-attempt-1",
      generatedAgentContextFingerprint: "generated-context-fingerprint-1",
      queueItemId: "queue-item-1",
      commandFacts: { sourceCommandId: "command-1" },
      auth: {
        kind: "bearer",
        token: "bridge-token-1",
        transport: "loopback-http",
      },
      surfaceTarget: { surfacePiSessionId: "pi-session-1" },
      promptTarget: { surfacePiSessionId: "pi-session-1" },
      threadId: "thread-1",
      turnId: "turn-1",
      idempotencyKey: "bridge:1",
      stateRevision: 1,
      generatedContextBindingId: "generated-context-binding-1",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["workflows"],
      systemPrompt: "hidden runtime-owned prompt",
      piMessages: [{ role: "user", content: "Review this." }],
      runtimeEffects: [],
      extensionExecutionPlan: { type: "child_process.command" },
      commandEnvelope: { commandId: "command-1" },
      taskAttemptId: "workflow-task-attempt-1",
    };

    for (const [field, value] of Object.entries(runtimeOwnedFields)) {
      expect(() =>
        unsafeDecodeRunTaskAgentSourceInputSyncForTestsAndBootstrap({
          ...sourceRequest,
          [field]: value,
        }),
      ).toThrow();
    }
  });

  it("decodes workflow task-agent bridge results as JSON-safe payloads", () => {
    expect(
      unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap({
        text: "Task completed.",
        usage: { inputTokens: 12, outputTokens: 4 },
        output: { files: ["src/index.ts"], ok: true },
      }),
    ).toEqual({
      text: "Task completed.",
      usage: { inputTokens: 12, outputTokens: 4 },
      output: { files: ["src/index.ts"], ok: true },
    });

    expect(() =>
      unsafeDecodeRunTaskAgentResultSyncForTestsAndBootstrap({
        text: "Task completed.",
        output: () => "not json",
      }),
    ).toThrow();
  });

  it("decodes workflow task-agent bridge errors as stable payloads", () => {
    const decoded: unknown = unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap({
      error: "task_attempt_failed",
      message: "Task failed.",
      retryable: true,
      requestId: "bridge-request-1",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      taskAttemptId: "workflow-task-attempt-1",
    });

    expect(decoded).toEqual({
      error: "task_attempt_failed",
      message: "Task failed.",
      retryable: true,
      requestId: "bridge-request-1",
      workspaceSessionId: "workspace-session-1",
      sourceCommandId: "command-1",
      taskAttemptId: "workflow-task-attempt-1",
    });

    expect(() =>
      unsafeDecodeRunTaskAgentErrorSyncForTestsAndBootstrap({
        error: "not_found",
        message: "Unsupported.",
        retryable: false,
      }),
    ).toThrow();
  });
});
