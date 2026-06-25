import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Stream from "effect/Stream";
import type {
  AbsolutePath,
  AcquireDefaultWorkspaceInput,
  AcquireWorkspaceInput,
  AnswerRuntimeApprovalInput,
  CloseSurfaceInput,
  AnswerRequestInputInput,
  CommandId,
  CreateOrchestratorSurfaceInput,
  ExtensionId,
  GeneratedPackagesRefreshResult,
  OpenExtensionSourceEditInput,
  OpenSurfaceInput,
  QueueItemId,
  RefreshGeneratedContextRequest,
  RefreshGeneratedPackagesRequest,
  ReleaseWorkspaceInput,
  RequestInputOptionId,
  RequestInputQuestionId,
  RequestInputRequestId,
  RuntimeApprovalId,
  RuntimeEvent,
  RuntimeEventGenerationId,
  RuntimeEventSequence,
  RuntimeOwnerId,
  SaveExtensionSourceEditInput,
  SetRequestInputTimerPausedInput,
  SourceEditSaveResult,
  SourceEditSession,
  SourceInvalidationHint,
  SourceReconcileRequest,
  SourceReconcileResult,
  SubmitMessageInput,
  SubmitMessageResult,
  SurfacePiSessionId,
  WriteCommandStdinInput,
  WorkspaceId,
  WorkspaceSessionId,
} from "@svvy/core";
import { RuntimeContractError, RuntimeEventRebaselineRequired } from "@svvy/core";

import { Runtime, createRuntimeFacade } from "./index";

type RuntimeService = Runtime["Service"];

const submitInput = {
  target: {
    workspaceSessionId: "wsess_01" as WorkspaceSessionId,
    surface: "orchestrator",
    surfacePiSessionId: "pi_orch_01" as SurfacePiSessionId,
  },
  message: { text: "Run the package boundary tests." },
  delivery: "enqueue-and-run",
} satisfies SubmitMessageInput;

const dependencyCommandId = "cmd_dependency_01" as CommandId;
const testEventGenerationId = "runtime-events-generation-test" as RuntimeEventGenerationId;
const runtimeEventSequence = (value: number) => value as RuntimeEventSequence;

function submitResult(input: SubmitMessageInput): SubmitMessageResult {
  return {
    queuedMessageId: "queue_01" as QueueItemId,
    target: input.target,
    status: "queued",
    receipt: {
      clientRequestId: null,
      outcome: "accepted",
      acceptedAt: "2026-04-18T09:00:00.000Z" as SubmitMessageResult["receipt"]["acceptedAt"],
      stateRevision: 1 as SubmitMessageResult["receipt"]["stateRevision"],
    },
  };
}

function createTestManagedRuntime(service: RuntimeService) {
  return ManagedRuntime.make(Layer.succeed(Runtime, service));
}

function testEventSubscription(
  stream: Stream.Stream<RuntimeEvent, never>,
  lastContiguousSequence: RuntimeEventSequence = runtimeEventSequence(0),
) {
  return {
    stream,
    close: () => Effect.void,
    closed: Effect.succeed({
      reason: "closed" as const,
      eventGenerationId: testEventGenerationId,
      lastContiguousSequence,
      rebaselineRequired: false as const,
    }),
  };
}

function appReadModelEvent(sequence: number): RuntimeEvent {
  return {
    type: "app_read_model.changed",
    eventGenerationId: testEventGenerationId,
    sequence: runtimeEventSequence(sequence),
    invalidation: { model: "extensions" },
  };
}

function expectTypedFacadeFailure(error: unknown): RuntimeContractError {
  expect(error).toMatchObject({
    name: "RuntimeFacadeError",
    type: "runtime-facade-error",
    reason: "typed-failure",
  });
  const typedError = (error as { readonly error?: unknown }).error;
  expect(typedError).toBeInstanceOf(RuntimeContractError);
  return typedError as RuntimeContractError;
}

const cancelledCommandResult = {
  commandId: "cmd_cancel_unused" as CommandId,
  status: "already_terminal" as const,
};

type RuntimeServiceTestOverrides = Pick<RuntimeService, "messages" | "queues" | "events"> & {
  commands: Partial<RuntimeService["commands"]>;
} & Partial<
    Pick<
      RuntimeService,
      | "workspaces"
      | "surfaces"
      | "requestInput"
      | "approvals"
      | "sourceEdits"
      | "sourceInvalidation"
    >
  >;

function runtimeService(overrides: RuntimeServiceTestOverrides): RuntimeService {
  const { commands, ...restOverrides } = overrides;
  return {
    workspaces: {
      acquire: () => Effect.die("unused"),
      acquireDefault: () => Effect.die("unused"),
      release: () => Effect.die("unused"),
    },
    surfaces: {
      createOrchestrator: () => Effect.die("unused"),
      open: () => Effect.die("unused"),
      close: () => Effect.die("unused"),
    },
    requestInput: {
      answer: () => Effect.die("unused"),
      setTimerPaused: () => Effect.die("unused"),
    },
    commands: {
      runExtensionDependencyAction: () => Effect.die("unused"),
      writeStdin: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
      ...commands,
    },
    approvals: {
      answer: () => Effect.die("unused"),
    },
    sourceEdits: {
      open: () => Effect.die("unused"),
      save: () => Effect.die("unused"),
    },
    sourceInvalidation: {
      hint: () => Effect.die("unused"),
      reconcile: () => Effect.die("unused"),
      refreshGeneratedContext: () => Effect.die("unused"),
      refreshGeneratedPackages: () => Effect.die("unused"),
    },
    ...restOverrides,
  };
}

async function collectEvents(iterable: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

describe("@svvy/runtime facade", () => {
  it("exposes only resolved runtime API groups without placeholder objects", async () => {
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.succeed(submitResult(submitInput)),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      expect(Object.keys(facade).toSorted()).toEqual([
        "approvals",
        "close",
        "commands",
        "events",
        "messages",
        "queues",
        "requestInput",
        "sourceEdits",
        "sourceInvalidation",
        "surfaces",
        "workspaces",
      ]);
      expect("handlerThreads" in facade).toBe(false);
      expect("recovery" in facade).toBe(false);
      expect("workflowTaskAgentBridge" in facade).toBe(false);
      expect(Reflect.has(facade.sourceInvalidation, "productStateChanged")).toBeFalse();
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards workspace, surface, and approval calls", async () => {
    const owner = {
      ownerId: "runtime_owner_01" as RuntimeOwnerId,
      kind: "test",
    } as const;
    const workspaceCwd = "/tmp/svvy-runtime-facade-workspace" as AbsolutePath;
    const workspaceId = "workspace_01" as WorkspaceId;
    const stateRevision = 1 as SubmitMessageResult["receipt"]["stateRevision"];
    const workspaceAcquireInput = {
      cwd: workspaceCwd,
      owner,
      openReason: "test",
    } satisfies AcquireWorkspaceInput;
    const workspaceAcquireDefaultInput = {
      owner,
      openReason: "test",
    } satisfies AcquireDefaultWorkspaceInput;
    const workspaceReleaseInput = {
      workspaceId,
      owner,
      releaseReason: "test",
    } satisfies ReleaseWorkspaceInput;
    const createSurfaceInput = {
      workspaceId,
      title: "Runtime facade test",
    } satisfies CreateOrchestratorSurfaceInput;
    const openSurfaceInput = {
      workspaceId,
      target: submitInput.target,
    } satisfies OpenSurfaceInput;
    const closeSurfaceInput = {
      target: submitInput.target,
      closeReason: "test",
    } satisfies CloseSurfaceInput;
    const approvalInput = {
      approvalId: "approval_01" as RuntimeApprovalId,
      decision: "approved",
      reason: "User approved.",
      clientSubmission: { source: "test" },
    } satisfies AnswerRuntimeApprovalInput;
    const workspaceResult = {
      workspaceId,
      cwd: workspaceCwd,
      kind: "user",
      acquired: "created",
      readiness: "ready",
      readinessDetail: { mode: "full" },
      stateRevision,
    } as const;
    const defaultWorkspaceResult = {
      ...workspaceResult,
      kind: "default",
      acquired: "existing",
    } as const;
    const surfaceResult = {
      workspaceSessionId: submitInput.target.workspaceSessionId,
      surfacePiSessionId: submitInput.target.surfacePiSessionId,
      target: submitInput.target,
      created: "new",
      stateRevision,
    } as const;
    const openedSurfaceResult = {
      workspaceSessionId: submitInput.target.workspaceSessionId,
      surfacePiSessionId: submitInput.target.surfacePiSessionId,
      target: submitInput.target,
      stateRevision,
    } as const;
    const closedSurfaceResult = {
      target: submitInput.target,
      lifecycle: "idle",
    } as const;
    const approvalResult = {
      approvalId: approvalInput.approvalId,
      commandId: dependencyCommandId,
      status: "approved",
    } as const;
    const acquired: AcquireWorkspaceInput[] = [];
    const acquiredDefault: AcquireDefaultWorkspaceInput[] = [];
    const released: ReleaseWorkspaceInput[] = [];
    const createdSurfaces: CreateOrchestratorSurfaceInput[] = [];
    const openedSurfaces: OpenSurfaceInput[] = [];
    const closedSurfaces: CloseSurfaceInput[] = [];
    const answeredApprovals: AnswerRuntimeApprovalInput[] = [];
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        workspaces: {
          acquire: (input) =>
            Effect.sync(() => {
              acquired.push(input);
              return workspaceResult;
            }),
          acquireDefault: (input) =>
            Effect.sync(() => {
              acquiredDefault.push(input);
              return defaultWorkspaceResult;
            }),
          release: (input) =>
            Effect.sync(() => {
              released.push(input);
              return {
                workspaceId: input.workspaceId,
                released: true,
                remainingOwners: 0,
                lifecycle: "disposed" as const,
              };
            }),
        },
        surfaces: {
          createOrchestrator: (input) =>
            Effect.sync(() => {
              createdSurfaces.push(input);
              return surfaceResult;
            }),
          open: (input) =>
            Effect.sync(() => {
              openedSurfaces.push(input);
              return openedSurfaceResult;
            }),
          close: (input) =>
            Effect.sync(() => {
              closedSurfaces.push(input);
              return closedSurfaceResult;
            }),
        },
        messages: {
          submit: () => Effect.succeed(submitResult(submitInput)),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        approvals: {
          answer: (input) =>
            Effect.sync(() => {
              answeredApprovals.push(input);
              return approvalResult;
            }),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.workspaces.acquire(workspaceAcquireInput)).resolves.toEqual(
        workspaceResult,
      );
      await expect(facade.workspaces.acquireDefault(workspaceAcquireDefaultInput)).resolves.toEqual(
        defaultWorkspaceResult,
      );
      await expect(facade.workspaces.release(workspaceReleaseInput)).resolves.toEqual({
        workspaceId,
        released: true,
        remainingOwners: 0,
        lifecycle: "disposed",
      });
      await expect(facade.surfaces.createOrchestrator(createSurfaceInput)).resolves.toEqual(
        surfaceResult,
      );
      await expect(facade.surfaces.open(openSurfaceInput)).resolves.toEqual(openedSurfaceResult);
      await expect(facade.surfaces.close(closeSurfaceInput)).resolves.toEqual(closedSurfaceResult);
      await expect(facade.approvals.answer(approvalInput)).resolves.toEqual(approvalResult);

      expect(acquired).toEqual([workspaceAcquireInput]);
      expect(acquiredDefault).toEqual([workspaceAcquireDefaultInput]);
      expect(released).toEqual([workspaceReleaseInput]);
      expect(createdSurfaces).toEqual([createSurfaceInput]);
      expect(openedSurfaces).toEqual([openSurfaceInput]);
      expect(closedSurfaces).toEqual([closeSurfaceInput]);
      expect(answeredApprovals).toEqual([approvalInput]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards message submission through the Effect Runtime service", async () => {
    const submitted: SubmitMessageInput[] = [];
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: (input) =>
            Effect.sync(() => {
              submitted.push(input);
              return submitResult(input);
            }),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.messages.submit(submitInput)).resolves.toEqual(submitResult(submitInput));
      expect(submitted).toEqual([submitInput]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards request-input answers through the Effect Runtime service", async () => {
    const answerInput = {
      surfacePiSessionId: "pi_orch_01" as SurfacePiSessionId,
      requestId: "rui_facade_01" as RequestInputRequestId,
      questionId: "ruiq_facade_01" as RequestInputQuestionId,
      answer: { kind: "option", optionId: "ruio_facade_01" as RequestInputOptionId },
      delivery: "enqueue-and-run",
      clientSubmission: {
        correlationId: "facade-answer-01",
        source: "test",
      },
    } satisfies AnswerRequestInputInput;
    const answered: AnswerRequestInputInput[] = [];
    const answerResult = {
      requestId: answerInput.requestId,
      questionId: answerInput.questionId,
      status: "recorded" as const,
      delivery: {
        kind: "nonblocking-queued" as const,
        queuedItemId: "queue_answer_01" as QueueItemId,
      },
    };
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.succeed(submitResult(submitInput)),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        requestInput: {
          answer: (input) =>
            Effect.sync(() => {
              answered.push(input);
              return answerResult;
            }),
          setTimerPaused: () => Effect.die("Unexpected requestInput.setTimerPaused call."),
        },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.requestInput.answer(answerInput)).resolves.toEqual(answerResult);
      expect(answered).toEqual([answerInput]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards request-input timer pauses through the Effect Runtime service", async () => {
    const pauseInput = {
      surfacePiSessionId: "pi_orch_01" as SurfacePiSessionId,
      requestId: "rui_facade_01" as RequestInputRequestId,
      paused: true,
      clientSubmission: {
        correlationId: "facade-timer-01",
        source: "test",
      },
    } satisfies SetRequestInputTimerPausedInput;
    const paused: SetRequestInputTimerPausedInput[] = [];
    const pauseResult = { requestId: pauseInput.requestId };
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.succeed(submitResult(submitInput)),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        requestInput: {
          answer: () => Effect.die("Unexpected requestInput.answer call."),
          setTimerPaused: (input) =>
            Effect.sync(() => {
              paused.push(input);
              return pauseResult;
            }),
        },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.requestInput.setTimerPaused(pauseInput)).resolves.toEqual(pauseResult);
      expect(paused).toEqual([pauseInput]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("rejects invalid facade message submissions before the service sees them", async () => {
    const submitted: SubmitMessageInput[] = [];
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: (input) =>
            Effect.sync(() => {
              submitted.push(input);
              return submitResult(input);
            }),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const error = await facade.messages
        .submit({
          ...submitInput,
          systemPrompt: "renderer-provided system prompts are not accepted",
        } as unknown as SubmitMessageInput)
        .catch((caught) => caught);
      const contractError = expectTypedFacadeFailure(error);

      expect(contractError).toMatchObject({
        operation: "runtime.messages.submit",
        reason: "schema-error",
      });
      expect(contractError.issues?.length).toBeGreaterThan(0);
      expect(submitted).toEqual([]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("uses AbortSignal as cancel-wait-only by default without interrupting runtime execution", async () => {
    let submitted = 0;
    let resolveSubmission: ((value: SubmitMessageResult) => void) | undefined;
    let resolveCompleted: (() => void) | undefined;
    const submissionGate = new Promise<SubmitMessageResult>((resolve) => {
      resolveSubmission = resolve;
    });
    const runtimeCompleted = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () =>
            Effect.gen(function* () {
              submitted += 1;
              const result = yield* Effect.promise(() => submissionGate);
              yield* Effect.sync(() => resolveCompleted?.());
              return result;
            }),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);
    const controller = new AbortController();

    try {
      const submission = facade.messages.submit(submitInput, { signal: controller.signal });
      controller.abort(new Error("stop runtime facade call"));
      await expect(submission).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "aborted",
      });
      expect(submitted).toBe(1);
      resolveSubmission?.(submitResult(submitInput));
      await expect(runtimeCompleted).resolves.toBeUndefined();
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("rejects request-runtime-cancel on non-cancellation facade methods", async () => {
    let submitted = 0;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () =>
            Effect.sync(() => {
              submitted += 1;
              return submitResult(submitInput);
            }),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const error = await facade.messages
        .submit(submitInput, { abortPolicy: "request-runtime-cancel" })
        .catch((caught) => caught);
      const contractError = expectTypedFacadeFailure(error);

      expect(contractError).toMatchObject({
        operation: "runtime.messages.submit",
        reason: "unsupported-operation",
      });
      expect(submitted).toBe(0);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("rejects malformed service submission results at the facade boundary", async () => {
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: (input) =>
            Effect.succeed({
              ...submitResult(input),
              generatedPromptPreview: "not part of the runtime result contract",
            } as unknown as SubmitMessageResult),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const error = await facade.messages.submit(submitInput).catch((caught) => caught);
      const contractError = expectTypedFacadeFailure(error);

      expect(contractError).toMatchObject({
        operation: "runtime.messages.submit",
        reason: "schema-error",
      });
      expect(contractError.issues?.length).toBeGreaterThan(0);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards user-clicked extension dependency commands through the command API", async () => {
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: (input) =>
            Effect.succeed({
              commandId: `cmd_${input.extensionId}_${input.requirementId}` as CommandId,
              status: "queued" as const,
            }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(
        facade.commands.runExtensionDependencyAction({
          scope: {
            kind: "app-global",
            originWorkspaceId: "workspace_01" as WorkspaceId,
          },
          extensionId: "web" as ExtensionId,
          requirementId: "tinyfish",
          action: "install",
          targetVersion: "0.1.6",
          clientSubmission: { source: "desktop" },
        }),
      ).resolves.toEqual({
        commandId: "cmd_web_tinyfish" as CommandId,
        status: "queued",
      });
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("rejects invalid command facade requests before command services run", async () => {
    let commandActions = 0;
    let stdinWrites = 0;
    let cancellations = 0;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.sync(() => {
              commandActions += 1;
              return { commandId: dependencyCommandId, status: "running" as const };
            }),
          writeStdin: () =>
            Effect.sync(() => {
              stdinWrites += 1;
              return {
                commandId: dependencyCommandId,
                status: "accepted" as const,
                acceptedBytes: 0,
              };
            }),
          cancel: () =>
            Effect.sync(() => {
              cancellations += 1;
              return cancelledCommandResult;
            }),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(
        facade.commands.runExtensionDependencyAction({
          extensionId: "web" as ExtensionId,
          requirementId: "tinyfish",
          action: "install",
          panelId: "extensions-pane-row",
        } as unknown as Parameters<typeof facade.commands.runExtensionDependencyAction>[0]),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      await expect(
        facade.commands.writeStdin({
          commandId: "cmd_stdin_01" as CommandId,
          input: "exit\n",
        } as unknown as Parameters<typeof facade.commands.writeStdin>[0]),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      await expect(
        facade.commands.cancel({
          commandId: "cmd_cancel_01" as CommandId,
          dockviewPanelId: "command-inspector",
        } as unknown as Parameters<typeof facade.commands.cancel>[0]),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(commandActions).toBe(0);
      expect(stdinWrites).toBe(0);
      expect(cancellations).toBe(0);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards command stdin writes through the command API", async () => {
    const written: WriteCommandStdinInput[] = [];
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          writeStdin: (input) =>
            Effect.sync(() => {
              written.push(input);
              return { commandId: input.commandId, status: "accepted" as const, acceptedBytes: 5 };
            }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);
    const stdinInput = {
      commandId: "cmd_stdin_01" as CommandId,
      text: "exit\n",
      clientSubmission: { source: "desktop", clientRequestId: "stdin-button" },
    } satisfies WriteCommandStdinInput;

    try {
      await expect(facade.commands.writeStdin(stdinInput)).resolves.toEqual({
        commandId: stdinInput.commandId,
        status: "accepted",
        acceptedBytes: 5,
      });
      expect(written).toEqual([stdinInput]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards command cancellation through the command API", async () => {
    const cancelled: CommandId[] = [];
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: (input) =>
            Effect.sync(() => {
              cancelled.push(input.commandId);
              return { commandId: input.commandId, status: "cancelling" as const };
            }),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(
        facade.commands.cancel({
          commandId: "cmd_cancel_01" as CommandId,
          reason: "User clicked cancel.",
          clientSubmission: { source: "desktop", clientRequestId: "cancel-button" },
        }),
      ).resolves.toEqual({
        commandId: "cmd_cancel_01" as CommandId,
        status: "cancelling",
      });
      expect(cancelled).toEqual(["cmd_cancel_01" as CommandId]);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards extension source edit sessions through the source edit API", async () => {
    const opened: OpenExtensionSourceEditInput[] = [];
    const saved: SaveExtensionSourceEditInput[] = [];
    const sourcePath = "/tmp/svvy/extensions/web/index.ts" as AbsolutePath;
    const session = {
      sourceKind: "user-extension",
      sourceId: "web",
      path: sourcePath,
      sourceVersion: "version_01",
      fingerprint: "fingerprint_01",
      text: "export default {};",
      diagnostics: [],
    } satisfies SourceEditSession;
    const saveResult = {
      status: "saved",
      sourceVersion: "version_02",
      fingerprint: "fingerprint_02",
      diagnostics: [],
      reconcileRequired: true,
    } satisfies SourceEditSaveResult;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        sourceEdits: {
          open: (input) =>
            Effect.sync(() => {
              opened.push(input);
              return session;
            }),
          save: (input) =>
            Effect.sync(() => {
              saved.push(input);
              return saveResult;
            }),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(
        facade.sourceEdits.open({
          sourceKind: "user-extension",
          sourceId: "web",
        }),
      ).resolves.toEqual(session);
      await expect(
        facade.sourceEdits.save({
          sourceKind: "user-extension",
          sourceId: "web",
          expectedSourceVersion: "version_01",
          text: "export default { loaded: true };",
          saveMode: "compare-and-swap",
          sourceCommandId: "cmd_source_save_01" as CommandId,
        }),
      ).resolves.toEqual(saveResult);
      expect(opened).toEqual([{ sourceKind: "user-extension", sourceId: "web" }]);
      expect(saved).toHaveLength(1);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("rejects invalid source edit facade requests before services run", async () => {
    let opened = 0;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        sourceEdits: {
          open: () =>
            Effect.sync(() => {
              opened += 1;
              return {
                sourceKind: "user-extension",
                sourceId: "web",
                path: "/tmp/source.ts" as AbsolutePath,
                sourceVersion: "version_01",
                fingerprint: "fingerprint_01",
                text: "",
                diagnostics: [],
              } satisfies SourceEditSession;
            }),
          save: () => Effect.die("unused"),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(
        facade.sourceEdits.open({
          sourceKind: "user-extension",
          sourceId: "web",
          path: "/tmp/source.ts" as AbsolutePath,
        } as unknown as Parameters<typeof facade.sourceEdits.open>[0]),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(opened).toBe(0);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("forwards source invalidation requests through the source invalidation API", async () => {
    const fileHints: SourceInvalidationHint[] = [];
    const reconciliations: SourceReconcileRequest[] = [];
    const contextRefreshes: RefreshGeneratedContextRequest[] = [];
    const packageRefreshes: RefreshGeneratedPackagesRequest[] = [];
    const reconcileResult = {
      changedReadModelCount: 0,
      generatedPackageRefreshes: [],
      recoveryWorkIds: [],
    } satisfies SourceReconcileResult;
    const packageRefreshResult = {
      scope: "app-global",
      packages: [{ packageName: "@svvyx/extensions", action: "written" }],
      workspaceLinks: [],
      recoveryWorkIds: [],
    } satisfies GeneratedPackagesRefreshResult;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        sourceInvalidation: {
          hint: (input) =>
            Effect.sync(() => {
              fileHints.push(input);
            }),
          reconcile: (input) =>
            Effect.sync(() => {
              reconciliations.push(input);
              return reconcileResult;
            }),
          refreshGeneratedContext: (input) =>
            Effect.sync(() => {
              contextRefreshes.push(input);
            }),
          refreshGeneratedPackages: (input) =>
            Effect.sync(() => {
              packageRefreshes.push(input);
              return packageRefreshResult;
            }),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);
    const changedPath = "/tmp/svvy/extensions/web/index.ts" as AbsolutePath;

    try {
      await expect(
        facade.sourceInvalidation.hint({
          scope: { kind: "app-global" },
          domain: "host_snippets",
          path: changedPath,
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      await expect(
        facade.sourceInvalidation.reconcile({
          scope: { kind: "workspace", workspaceId: "workspace_01" as WorkspaceId },
          domains: ["workflows"],
          reason: "manual",
        }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(fileHints).toEqual([]);
      expect(reconciliations).toEqual([]);

      await expect(
        facade.sourceInvalidation.hint({
          scope: { kind: "app-global" },
          domain: "extensions",
          path: changedPath,
          observedAt: "2026-06-19T08:00:00.000Z",
        }),
      ).resolves.toBeUndefined();
      await expect(
        facade.sourceInvalidation.reconcile({
          scope: { kind: "workspace", workspaceId: "workspace_01" as WorkspaceId },
          domains: ["external_instructions", "host_snippets"],
          reason: "watcher-debounce",
        }),
      ).resolves.toEqual(reconcileResult);
      await expect(
        facade.sourceInvalidation.refreshGeneratedContext({
          scope: "workspace",
          workspaceId: "workspace_01" as WorkspaceId,
          reason: "extension-source-changed",
        }),
      ).resolves.toBeUndefined();
      await expect(
        facade.sourceInvalidation.refreshGeneratedPackages({
          scope: "app-global",
          packages: ["@svvyx/extensions"],
          reason: "source-changed",
        }),
      ).resolves.toEqual(packageRefreshResult);

      expect(fileHints).toEqual([
        {
          scope: { kind: "app-global" },
          domain: "extensions",
          path: changedPath,
          observedAt: "2026-06-19T08:00:00.000Z",
        },
      ]);
      expect(reconciliations).toEqual([
        {
          scope: { kind: "workspace", workspaceId: "workspace_01" as WorkspaceId },
          domains: ["external_instructions", "host_snippets"],
          reason: "watcher-debounce",
        },
      ]);
      expect(contextRefreshes).toHaveLength(1);
      expect(packageRefreshes).toHaveLength(1);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("converts runtime event streams to AsyncIterable without snapshot payload ownership", async () => {
    const events = [
      appReadModelEvent(1),
      {
        type: "workspace_read_model.changed",
        eventGenerationId: testEventGenerationId,
        sequence: runtimeEventSequence(2),
        workspaceId: "workspace_01" as WorkspaceId,
        invalidation: { model: "appLogs" },
      },
    ] satisfies RuntimeEvent[];
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: (input) =>
          Effect.succeed(
            testEventSubscription(
              input?.includeAppEvents === true ? Stream.fromIterable(events) : Stream.empty,
              runtimeEventSequence(2),
            ),
          ),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(collectEvents(await facade.events({ includeAppEvents: true }))).resolves.toEqual(
        events,
      );
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("closes active event iterators when the facade closes", async () => {
    let finalized = 0;
    const event = appReadModelEvent(1);
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () =>
          Effect.succeed(
            testEventSubscription(
              Stream.make(event).pipe(
                Stream.concat(Stream.never),
                Stream.ensuring(
                  Effect.sync(() => {
                    finalized += 1;
                  }),
                ),
              ),
              event.sequence,
            ),
          ),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const iterator = (await facade.events({ includeAppEvents: true }))[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: event });
      expect(finalized).toBe(0);

      await facade.close();
      expect(finalized).toBe(1);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("closes event iterator scopes on natural completion", async () => {
    let finalized = 0;
    const event = appReadModelEvent(1);
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () =>
          Effect.succeed(
            testEventSubscription(
              Stream.make(event).pipe(
                Stream.ensuring(
                  Effect.sync(() => {
                    finalized += 1;
                  }),
                ),
              ),
              event.sequence,
            ),
          ),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const iterator = (await facade.events({ includeAppEvents: true }))[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: event });
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
      expect(finalized).toBe(1);

      await facade.close();
      expect(finalized).toBe(1);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("closes event iterator scopes when next rejects", async () => {
    let finalized = 0;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () =>
          Effect.succeed(
            testEventSubscription(
              Stream.make({
                type: "not_a_runtime_event",
                sequence: 1,
              } as unknown as RuntimeEvent).pipe(
                Stream.ensuring(
                  Effect.sync(() => {
                    finalized += 1;
                  }),
                ),
              ),
            ),
          ),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const iterator = (await facade.events({ includeAppEvents: true }))[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(finalized).toBe(1);

      await facade.close();
      expect(finalized).toBe(1);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("closes event iterator scopes when callers throw into the wrapper", async () => {
    let finalized = 0;
    const event = appReadModelEvent(1);
    const thrown = new Error("consumer stopped");
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () =>
          Effect.succeed(
            testEventSubscription(
              Stream.make(event).pipe(
                Stream.concat(Stream.never),
                Stream.ensuring(
                  Effect.sync(() => {
                    finalized += 1;
                  }),
                ),
              ),
              event.sequence,
            ),
          ),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      const iterator = (await facade.events({ includeAppEvents: true }))[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toEqual({ done: false, value: event });
      await expect(iterator.throw?.(thrown)).rejects.toBe(thrown);
      expect(finalized).toBe(1);

      await facade.close();
      expect(finalized).toBe(1);
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("rejects invalid event subscriptions and malformed service events at the facade boundary", async () => {
    let subscribed = 0;
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.die("unused"),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => {
          subscribed += 1;
          return Effect.succeed(
            testEventSubscription(
              Stream.fromIterable([
                {
                  type: "app_read_model.changed",
                  eventGenerationId: testEventGenerationId,
                  sequence: runtimeEventSequence(1),
                  invalidation: { model: "extensions" },
                  readModel: { rendererSnapshot: true },
                } as unknown as RuntimeEvent,
              ]),
              runtimeEventSequence(1),
            ),
          );
        },
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(
        facade.events({
          includeAppEvents: true,
          panelId: "renderer-transcript",
        } as unknown as Parameters<typeof facade.events>[0]),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(subscribed).toBe(0);

      await expect(
        collectEvents(await facade.events({ includeAppEvents: true })),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
      });
      expect(subscribed).toBe(1);
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("rejects facade calls after the facade is closed", async () => {
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.succeed(submitResult(submitInput)),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await facade.close();
      await expect(facade.messages.submit(submitInput)).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "disposed",
      });
      await expect(facade.events()).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "disposed",
      });
    } finally {
      await managedRuntime.dispose();
    }
  });

  it("wraps typed Effect failures through the Promise facade", async () => {
    const typedFailure = new RuntimeContractError({
      operation: "runtime.messages.submit",
      reason: "invalid-input",
      message: "The submitted message is invalid.",
    });
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.fail(typedFailure),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.messages.submit(submitInput)).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "typed-failure",
        error: typedFailure,
      });
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("wraps aborted facade calls as aborted facade errors", async () => {
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.never,
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);
    const controller = new AbortController();
    controller.abort();

    try {
      await expect(
        facade.messages.submit(submitInput, { signal: controller.signal }),
      ).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "aborted",
      });
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("wraps interrupted runtime fibers as interrupted facade errors", async () => {
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.interrupt,
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.succeed(testEventSubscription(Stream.empty)),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.messages.submit(submitInput)).rejects.toMatchObject({
        type: "runtime-facade-error",
        reason: "interrupted",
      });
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });

  it("wraps runtime event rebaseline errors through the AsyncIterable facade", async () => {
    const error = new RuntimeEventRebaselineRequired({
      reason: "stale-cursor",
      requestedAfterSequence: runtimeEventSequence(4),
      retainedFromSequence: runtimeEventSequence(10),
      currentHighWaterSequence: runtimeEventSequence(24),
      eventGenerationId: testEventGenerationId,
      affectedReadModels: [],
      workspaceId: "workspace_01" as WorkspaceId,
      message: "Requested event sequence is outside the retained replay window.",
    });
    const managedRuntime = createTestManagedRuntime(
      runtimeService({
        messages: {
          submit: () => Effect.succeed(submitResult(submitInput)),
          abort: () => Effect.void,
        },
        queues: { steer: () => Effect.void },
        commands: {
          runExtensionDependencyAction: () =>
            Effect.succeed({ commandId: dependencyCommandId, status: "running" as const }),
          cancel: () => Effect.succeed(cancelledCommandResult),
        },
        events: () => Effect.fail(error),
      }),
    );
    const facade = createRuntimeFacade(managedRuntime);

    try {
      await expect(facade.events({ afterSequence: runtimeEventSequence(4) })).rejects.toMatchObject(
        {
          type: "runtime-facade-error",
          reason: "typed-failure",
          error,
        },
      );
    } finally {
      await facade.close();
      await managedRuntime.dispose();
    }
  });
});
