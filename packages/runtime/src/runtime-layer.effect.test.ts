import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  RuntimeApprovalStatePort,
  RuntimeCommandStatePort,
  RuntimeContractError,
  RuntimeEventStreamError,
  RuntimeGeneratedPackageStatePort,
  RuntimeQueueStatePort,
  RuntimeRequestStatePort,
  RuntimeSessionWaitStatePort,
  RuntimeSourceStatePort,
  RuntimeSurfaceLifecycleStatePort,
  RuntimeWorkspaceStatePort,
  StateContractError,
  type AbsolutePath,
  type AcquireWorkspaceInput,
  type AcquireWorkspaceResult,
  type CommandId,
  type CreateOrchestratorSurfaceInput,
  type CreateSurfaceResult,
  type FinishRuntimeCommandInput,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeEventSequence,
  type RuntimeOwnerId,
  type StateInvalidationDescriptor,
  type SurfacePiSessionId,
  type WorkspaceId,
  type WorkspaceSessionId,
} from "@svvy/core";
import { Runtime } from "./index";
import {
  RuntimeLayerAppLogPort,
  RuntimeLayerApprovalPostCommitPort,
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandStdinPort,
  RuntimeLayerDevTelemetryPort,
  RuntimeLayerEventsPort,
  RuntimeLayerModelResolverPort,
  RuntimeLayerPromptHostPort,
  RuntimeLayerProviderAuthPort,
  RuntimeLayerRequestInputPostCommitPort,
  RuntimeLayerSourceEditsPort,
  RuntimeLayerSourceInvalidationPort,
} from "./runtime-layer";

const workspaceId = "workspace_runtime_layer_effect" as WorkspaceId;
const workspaceCwd = "/tmp/svvy-runtime-layer-effect" as AbsolutePath;
const workspaceSessionId = "wsess_runtime_layer_effect" as WorkspaceSessionId;
const surfacePiSessionId = "pi_orch_runtime_layer_effect" as SurfacePiSessionId;
const stateRevision = 1 as AcquireWorkspaceResult["stateRevision"];
const owner = {
  ownerId: "runtime_layer_effect_owner" as RuntimeOwnerId,
  kind: "test",
} as const;

const target = {
  workspaceSessionId,
  surface: "orchestrator",
  surfacePiSessionId,
} as const;

const workspaceInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "sessionNavigation" },
} satisfies StateInvalidationDescriptor;

const surfaceInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "surface", ids: [surfacePiSessionId] },
} satisfies StateInvalidationDescriptor;

const commandInvalidation = {
  scope: "workspace",
  workspaceId,
  invalidation: { model: "commandInspector", ids: ["cmd_runtime_layer_effect" as CommandId] },
} satisfies StateInvalidationDescriptor;

describe("@svvy/runtime Runtime.layer", () => {
  it.effect(
    "routes workspace and surface lifecycle through state ports and publishes after-commit invalidations",
    () => {
      const published: StateInvalidationDescriptor[][] = [];
      const acquired: AcquireWorkspaceInput[] = [];
      const createdSurfaces: CreateOrchestratorSurfaceInput[] = [];

      return Effect.gen(function* () {
        const runtime = yield* Runtime;

        const workspaceInput = {
          cwd: workspaceCwd,
          owner,
          openReason: "test",
        } satisfies AcquireWorkspaceInput;
        const createSurfaceInput = {
          workspaceId,
          title: "Runtime layer Effect test",
        } satisfies CreateOrchestratorSurfaceInput;

        const acquiredWorkspace = yield* runtime.workspaces.acquire(workspaceInput);
        const createdSurface = yield* runtime.surfaces.createOrchestrator(createSurfaceInput);

        assert.deepStrictEqual(acquired, [workspaceInput]);
        assert.deepStrictEqual(createdSurfaces, [createSurfaceInput]);
        assert.deepStrictEqual(acquiredWorkspace, workspaceResult("created"));
        assert.deepStrictEqual(createdSurface, surfaceResult);
        assert.deepStrictEqual(published, [[workspaceInvalidation], [surfaceInvalidation]]);
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published,
            onAcquireWorkspace: (input) => {
              acquired.push(input);
              return workspaceResult("created");
            },
            onCreateSurface: (input) => {
              createdSurfaces.push(input);
              return surfaceResult;
            },
          }),
        ),
      );
    },
  );

  it.effect(
    "maps state-port failures to public RuntimeContractError without publishing invalidations",
    () =>
      Effect.gen(function* () {
        const runtime = yield* Runtime;
        const failure = yield* runtime.workspaces
          .acquire({
            cwd: workspaceCwd,
            owner,
            openReason: "test",
          })
          .pipe(Effect.flip);

        assert.instanceOf(failure, RuntimeContractError);
        assert.deepInclude(failure, {
          operation: "runtime.workspaces.acquire",
          reason: "stale-state",
        });
      }).pipe(
        Effect.provide(
          testRuntimeLayer({
            published: [],
            failAcquireWorkspace: new StateContractError({
              operation: "runtime-layer-effect.acquire",
              reason: "stale-state",
              message: "Workspace owner is stale.",
            }),
          }),
        ),
      ),
  );

  it.effect("cancels running commands through live control before terminalizing state", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const cancelledCommands: CommandId[] = [];
    const finishedCommands: FinishRuntimeCommandInput[] = [];

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const result = yield* runtime.commands.cancel({
        commandId: "cmd_runtime_layer_effect" as CommandId,
        reason: "test cancellation",
      });

      assert.deepStrictEqual(result, {
        commandId: "cmd_runtime_layer_effect",
        status: "cancelled",
      });
      assert.deepStrictEqual(cancelledCommands, ["cmd_runtime_layer_effect"]);
      assert.deepStrictEqual(finishedCommands, [
        {
          commandId: "cmd_runtime_layer_effect",
          status: "cancelled",
          summary: "Command cancelled: test cancellation",
          facts: { cancelReason: "test cancellation", requestedBy: null },
          error: "test cancellation",
        },
      ]);
      assert.deepStrictEqual(published, [[commandInvalidation]]);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published,
          commandRecord: runtimeCommandRecord("running"),
          onCancelCommand: (input) => {
            cancelledCommands.push(input.commandId);
            return { commandId: input.commandId, status: "cancelled" as const };
          },
          onFinishCommand: (input) => {
            finishedCommands.push(input);
            return runtimeCommandRecord(input.status);
          },
        }),
      ),
    );
  });

  it.effect("does not call live control or publish invalidations for terminal commands", () => {
    const published: StateInvalidationDescriptor[][] = [];
    const cancelledCommands: CommandId[] = [];

    return Effect.gen(function* () {
      const runtime = yield* Runtime;
      const result = yield* runtime.commands.cancel({
        commandId: "cmd_runtime_layer_effect" as CommandId,
      });

      assert.deepStrictEqual(result, {
        commandId: "cmd_runtime_layer_effect",
        status: "already_terminal",
      });
      assert.deepStrictEqual(cancelledCommands, []);
      assert.deepStrictEqual(published, []);
    }).pipe(
      Effect.provide(
        testRuntimeLayer({
          published,
          commandRecord: runtimeCommandRecord("succeeded"),
          onCancelCommand: (input) => {
            cancelledCommands.push(input.commandId);
            return { commandId: input.commandId, status: "cancelled" as const };
          },
        }),
      ),
    );
  });
});

interface TestLayerOverrides {
  readonly published: StateInvalidationDescriptor[][];
  readonly onAcquireWorkspace?: (input: AcquireWorkspaceInput) => AcquireWorkspaceResult;
  readonly onCreateSurface?: (input: CreateOrchestratorSurfaceInput) => CreateSurfaceResult;
  readonly failAcquireWorkspace?: StateContractError;
  readonly commandRecord?: RuntimeCommandRecord | null;
  readonly onCancelCommand?: (input: Parameters<RuntimeLayerCommandControlPort["cancel"]>[0]) => {
    readonly commandId: CommandId;
    readonly status: "cancelling" | "cancelled" | "already_terminal";
  };
  readonly onFinishCommand?: (input: FinishRuntimeCommandInput) => RuntimeCommandRecord;
}

function testRuntimeLayer(overrides: TestLayerOverrides) {
  return Runtime.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RuntimeLayerPromptHostPort, {
          resolvePromptDefaultsForTarget: () => ({
            provider: "openai",
            model: "gpt-4o",
            reasoningEffort: "medium" as const,
          }),
          afterRuntimeSurfaceMessageQueued: () =>
            Promise.resolve({ dispatched: false, target, queued: true }),
          afterRuntimeQueuedMessageAborted: () => Promise.resolve({ ok: true }),
          afterRuntimeSurfaceMessageSteered: () => Promise.resolve({ ok: true }),
          cancelActivePrompt: () => Promise.resolve(),
          cancelPrompt: () => Promise.resolve(),
        }),
        Layer.succeed(RuntimeLayerRequestInputPostCommitPort, {
          afterRequestInputAnswered: () => Promise.resolve({ ok: true }),
          afterRequestInputTimerPaused: () => Promise.resolve({ ok: true }),
        }),
        Layer.succeed(RuntimeLayerApprovalPostCommitPort, {
          resolveRuntimeApprovalAnswer: () => Promise.resolve({ ok: true }),
        }),
        Layer.succeed(RuntimeLayerProviderAuthPort, {
          ensureUsableProviderAuth: () => Promise.resolve("test-api-key"),
          getProviderAuthUnavailableMessage: () => "Provider auth unavailable.",
        }),
        Layer.succeed(RuntimeLayerModelResolverPort, {
          resolveModelId: () => Effect.succeed("gpt-4o"),
        }),
        Layer.succeed(RuntimeLayerDevTelemetryPort, {
          recordDevBrowserToolsEvent: () => {},
        }),
        Layer.succeed(RuntimeLayerAppLogPort, {
          info: () => {},
          warning: () => {},
          error: () => {},
        }),
        Layer.succeed(RuntimeLayerSourceEditsPort, {
          open: () => Promise.reject(new Error("Unexpected source edit open call.")),
          save: () => Promise.reject(new Error("Unexpected source edit save call.")),
        }),
        Layer.succeed(RuntimeLayerSourceInvalidationPort, {
          hint: () => Promise.resolve(),
          reconcile: () =>
            Promise.resolve({
              changedReadModelCount: 0,
              generatedPackageRefreshes: [],
              recoveryWorkIds: [],
            }),
          refreshGeneratedContext: () => Promise.resolve(),
          refreshGeneratedPackages: () =>
            Promise.resolve({
              scope: "app-global" as const,
              packages: [],
              workspaceLinks: [],
              recoveryWorkIds: [],
            }),
        }),
        Layer.succeed(RuntimeLayerEventsPort, {
          events: () =>
            Effect.fail(
              new RuntimeEventStreamError({
                operation: "runtime.events",
                reason: "stream-failed",
                message: "unused",
                latestSequence: 0 as RuntimeEventSequence,
              }),
            ),
          publishStateInvalidations: (input) =>
            Effect.sync(() => {
              overrides.published.push([...input.afterCommit]);
              return [];
            }),
        }),
        Layer.succeed(RuntimeLayerCommandStdinPort, {
          writeStdin: () =>
            Effect.succeed({
              commandId: "cmd_unused" as CommandId,
              status: "already_terminal" as const,
            }),
        }),
        Layer.succeed(RuntimeLayerCommandControlPort, {
          cancel: (input) =>
            Effect.sync(
              () =>
                overrides.onCancelCommand?.(input) ?? {
                  commandId: input.commandId,
                  status: "already_terminal" as const,
                },
            ),
        }),
        Layer.succeed(RuntimeWorkspaceStatePort, {
          acquireWorkspace: (input) => {
            if (overrides.failAcquireWorkspace) {
              return Effect.fail(overrides.failAcquireWorkspace);
            }
            return Effect.sync(() => ({
              value: overrides.onAcquireWorkspace?.(input) ?? workspaceResult("existing"),
              afterCommit: [workspaceInvalidation],
            }));
          },
          acquireDefaultWorkspace: () =>
            Effect.succeed({
              value: { ...workspaceResult("existing"), kind: "default" as const },
              afterCommit: [workspaceInvalidation],
            }),
          releaseWorkspace: (input) =>
            Effect.succeed({
              value: {
                workspaceId: input.workspaceId,
                released: true as const,
                remainingOwners: 0,
                lifecycle: "idle" as const,
              },
              afterCommit: [workspaceInvalidation],
            }),
        }),
        Layer.succeed(RuntimeSurfaceLifecycleStatePort, {
          createOrchestratorSurface: (input) =>
            Effect.sync(() => ({
              value: overrides.onCreateSurface?.(input) ?? surfaceResult,
              afterCommit: [surfaceInvalidation],
            })),
          openSurface: (input) =>
            Effect.succeed({
              value: {
                workspaceSessionId: input.target.workspaceSessionId,
                surfacePiSessionId: input.target.surfacePiSessionId,
                target: input.target,
                stateRevision,
              },
              afterCommit: [surfaceInvalidation],
            }),
          closeSurface: (input) =>
            Effect.succeed({
              value: {
                target: input.target,
                lifecycle: "idle" as const,
              },
              afterCommit: [surfaceInvalidation],
            }),
        }),
        Layer.succeed(RuntimeSourceStatePort, {
          readSourceVersion: () => Effect.succeed(null),
          recordSourceSave: () => Effect.die("unused"),
          recordSourceDelete: () => Effect.die("unused"),
        }),
        Layer.succeed(RuntimeQueueStatePort, unusedPort("RuntimeQueueStatePort")),
        Layer.succeed(RuntimeRequestStatePort, unusedPort("RuntimeRequestStatePort")),
        Layer.succeed(RuntimeApprovalStatePort, unusedPort("RuntimeApprovalStatePort")),
        Layer.succeed(RuntimeCommandStatePort, testRuntimeCommandStatePort(overrides)),
        Layer.succeed(
          RuntimeGeneratedPackageStatePort,
          unusedPort("RuntimeGeneratedPackageStatePort"),
        ),
        Layer.succeed(RuntimeSessionWaitStatePort, unusedPort("RuntimeSessionWaitStatePort")),
      ),
    ),
  );
}

function workspaceResult(acquired: AcquireWorkspaceResult["acquired"]): AcquireWorkspaceResult {
  return {
    workspaceId,
    cwd: workspaceCwd,
    kind: "user",
    acquired,
    readiness: "ready",
    readinessDetail: { mode: "full" },
    stateRevision,
  };
}

const surfaceResult = {
  workspaceSessionId,
  surfacePiSessionId,
  target,
  created: "new",
  stateRevision,
} satisfies CreateSurfaceResult;

function runtimeCommandRecord(status: RuntimeCommandRecord["status"]): RuntimeCommandRecord {
  return {
    id: "cmd_runtime_layer_effect",
    sessionId: "session_runtime_layer_effect",
    turnId: "turn_runtime_layer_effect",
    workflowTaskAttemptId: null,
    surfacePiSessionId,
    threadId: null,
    workflowRunId: null,
    parentCommandId: null,
    toolName: "exec_command",
    executor: "orchestrator",
    visibility: "summary",
    status,
    attempts: 1,
    title: "Runtime layer command",
    summary: "Runtime layer command.",
    arguments: null,
    facts: null,
    error: null,
    startedAt: "2026-04-18T09:00:00.000Z",
    updatedAt: "2026-04-18T09:00:00.000Z",
    finishedAt:
      status === "succeeded" || status === "failed" || status === "cancelled"
        ? "2026-04-18T09:01:00.000Z"
        : null,
  };
}

function testRuntimeCommandStatePort(
  overrides: TestLayerOverrides,
): RuntimeCommandStatePortService {
  return {
    createCommand: () => Effect.die("Unexpected createCommand call."),
    createOrReuseStreamingCommand: () =>
      Effect.die("Unexpected createOrReuseStreamingCommand call."),
    findCommandByToolCallId: () => Effect.die("Unexpected findCommandByToolCallId call."),
    findCommandById: () => Effect.succeed(overrides.commandRecord ?? null),
    updateCommandArguments: () => Effect.die("Unexpected updateCommandArguments call."),
    startCommand: () => Effect.die("Unexpected startCommand call."),
    finishCommand: (input) =>
      Effect.succeed({
        value: overrides.onFinishCommand?.(input) ?? runtimeCommandRecord(input.status),
        afterCommit: [commandInvalidation],
      }),
    recordCommandEvent: () => Effect.die("Unexpected recordCommandEvent call."),
    recordStdinWrite: () => Effect.die("Unexpected recordStdinWrite call."),
    hasCommandOutputEvent: () => Effect.die("Unexpected hasCommandOutputEvent call."),
  };
}

function unusedPort(label: string): never {
  return new Proxy(
    {},
    {
      get() {
        throw new Error(`${label} is unused by this test.`);
      },
    },
  ) as never;
}
