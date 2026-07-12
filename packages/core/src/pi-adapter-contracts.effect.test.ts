import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import {
  decodeUnknownCreatePiSessionInputEffect,
  decodeUnknownInterruptPiTurnInputEffect,
  decodeUnknownListModelsInputEffect,
  decodeUnknownModelSelectionEffect,
  unsafeDecodeNativeToolResultSyncForTestsAndBootstrap,
  decodeUnknownDeletePiSessionReferenceInputEffect,
  decodeUnknownGetPiSessionReferenceInputEffect,
  decodeUnknownResolvePiRuntimePathsInputEffect,
  decodeUnknownSavePiSessionReferenceInputEffect,
  decodeUnknownValidatePiSessionReferenceInputEffect,
  decodeUnknownReasoningSelectionEffect,
  encodeModelSelectionEffect,
  encodeReasoningSelectionEffect,
  encodeSavePiSessionReferenceInputEffect,
  unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  type GeneratedContextFingerprint,
  type GeneratedContextRevision,
  type ModelId,
  type AbsolutePath,
  type PiRuntimePathsPortService,
  type PiSessionReferencePortService,
  type ProviderId,
  type ProviderAuthPortService,
  type ProviderAuthStatusStatePortService,
  type RunPiTurnInput,
  type SurfacePiSessionId,
  type ToolCallId,
  type TurnId,
  type WorkspaceId,
} from ".";

describe("@svvy/core pi adapter contracts", () => {
  it.effect("defines pi-free turn input contracts from core ids, messages, and native tools", () =>
    Effect.gen(function* () {
      const invoked: unknown[] = [];
      const input = {
        session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
        turnId: "turn_01" as TurnId,
        surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
        userMessage: { text: "Inspect the failing test." },
        userMessageSubmittedAt: "2026-06-23T12:35:01.000Z",
        systemPromptBinding: {
          fingerprint: "gctx_01" as GeneratedContextFingerprint,
          revision: "rev_01" as GeneratedContextRevision,
          text: "You are a focused handler.",
        },
        model: {
          providerId: "openai" as ProviderId,
          modelId: "gpt-5.5" as ModelId,
        },
        reasoning: { effort: "high" },
        tools: [
          {
            name: "exec_command",
            label: "exec_command",
            description: "Run a command.",
            parameters: { type: "object" },
          },
        ],
        toolExecutor: (execution) => {
          invoked.push(execution);
          return Effect.succeed({ content: [{ type: "text", text: "ok" }] });
        },
        enabledAmbientPiResources: [
          {
            kind: "pi_builtin_tool",
            resourceId: "shell.exec",
            enabledByBindingFingerprint: "gctx_01" as GeneratedContextFingerprint,
          },
        ],
      } satisfies RunPiTurnInput;

      const emit = () => Effect.void;

      assert.deepStrictEqual(
        yield* input.toolExecutor({
          turnId: "turn_01" as TurnId,
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          piToolCallId: "tool_call_01" as ToolCallId,
          toolName: "exec_command",
          argumentsJson: '{"cmd":"pwd"}',
          emit,
        }),
        { content: [{ type: "text", text: "ok" }] },
      );
      assert.strictEqual(input.model.providerId, "openai" as ProviderId);
      assert.strictEqual(input.reasoning.effort, "high");
      assert.strictEqual(input.userMessageSubmittedAt, "2026-06-23T12:35:01.000Z");
      assert.deepStrictEqual(input.enabledAmbientPiResources, [
        {
          kind: "pi_builtin_tool",
          resourceId: "shell.exec",
          enabledByBindingFingerprint: "gctx_01" as GeneratedContextFingerprint,
        },
      ]);
      assert.deepStrictEqual(invoked, [
        {
          turnId: "turn_01",
          surfacePiSessionId: "pi_surface_01",
          piToolCallId: "tool_call_01",
          toolName: "exec_command",
          argumentsJson: '{"cmd":"pwd"}',
          emit,
        },
      ]);
    }),
  );

  it.effect(
    "decodes closed model, reasoning, native-tool result, and pi runtime event schemas",
    () =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* decodeUnknownModelSelectionEffect({ providerId: "openai", modelId: "gpt-5.5" }),
          {
            providerId: "openai" as ProviderId,
            modelId: "gpt-5.5" as ModelId,
          },
        );
        assert.deepStrictEqual(
          yield* encodeModelSelectionEffect({
            providerId: "openai" as ProviderId,
            modelId: "gpt-5.5" as ModelId,
          }),
          {
            providerId: "openai",
            modelId: "gpt-5.5",
          },
        );
        assert.deepStrictEqual(yield* decodeUnknownReasoningSelectionEffect({ effort: "xhigh" }), {
          effort: "xhigh",
        });
        assert.deepStrictEqual(yield* encodeReasoningSelectionEffect({ effort: "xhigh" }), {
          effort: "xhigh",
        });
        assert.deepStrictEqual(
          unsafeDecodeNativeToolResultSyncForTestsAndBootstrap({
            content: [{ type: "text", text: "ok" }],
            details: { status: "succeeded", summary: "ok" },
          }),
          {
            content: [{ type: "text", text: "ok" }],
            details: { status: "succeeded", summary: "ok" },
          },
        );
        assert.deepStrictEqual(
          yield* decodeUnknownInterruptPiTurnInputEffect({
            surfacePiSessionId: "pi_surface_01",
            turnId: "turn_01",
          }),
          {
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            turnId: "turn_01" as TurnId,
          },
        );
        yield* decodeUnknownInterruptPiTurnInputEffect({
          surfacePiSessionId: "pi_surface_01",
          turnId: "turn_01",
          rendererOnly: true,
        }).pipe(Effect.flip);
        yield* decodeUnknownCreatePiSessionInputEffect({
          workspaceId: "workspace_01",
          workspaceSessionId: "workspace_session_01",
          surfacePiSessionId: "pi_surface_01",
          actorKind: "orchestrator",
          agentProfileId: undefined,
          generatedContextFingerprint: "gctx_01",
          model: { providerId: "openai", modelId: "gpt-5.5" },
          reasoning: { effort: "high" },
        }).pipe(Effect.flip);
        yield* decodeUnknownListModelsInputEffect({
          workspaceId: "workspace_01",
          providerId: undefined,
        }).pipe(Effect.flip);
        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.assistant.text.delta",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            piMessageRef: "pi_msg_9",
            contentIndex: 0,
            delta: "",
          }),
          {
            type: "pi.assistant.text.delta",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            piMessageRef: "pi_msg_9",
            contentIndex: 0,
            delta: "",
          },
        );
        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.tool_call.arguments.delta",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            piMessageRef: "pi_msg_9",
            toolCallId: "tool_21",
            toolName: "exec_command",
            delta: '{"cmd":"bun run test:unit"',
            contentIndex: 0,
          }),
          {
            type: "pi.tool_call.arguments.delta",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            piMessageRef: "pi_msg_9",
            toolCallId: "tool_21" as ToolCallId,
            toolName: "exec_command",
            delta: '{"cmd":"bun run test:unit"',
            contentIndex: 0,
          },
        );
        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.assistant_message.committed",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            piMessageRef: "pi_msg_9",
            content: [
              { kind: "thinking", contentIndex: 0, thinking: "Inspect." },
              {
                kind: "tool-call",
                contentIndex: 1,
                toolCallId: "tool_21",
                toolName: "exec_command",
                argumentsJson: '{"cmd":"bun test"}',
                argumentsStatus: "accepted",
                commandId: null,
              },
              { kind: "text", contentIndex: 2, text: "Done." },
            ],
            api: "openai-responses",
            providerId: "openai",
            modelId: "gpt-5.5",
            responseId: "response_9",
            usage: {
              input: 10,
              output: 5,
              cacheRead: 2,
              cacheWrite: 0,
              totalTokens: 15,
              cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0, total: 0.31 },
            },
            stopReason: "toolUse",
            errorMessage: null,
            piHistoryEntry: {
              session: { surfacePiSessionId: "pi_surface_01" },
              entryId: "history_9",
            },
            messageTimestamp: "2026-07-11T12:00:00.000Z",
            finishedAt: "2026-07-11T12:00:01.000Z",
          }),
          {
            type: "pi.assistant_message.committed",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            piMessageRef: "pi_msg_9",
            content: [
              { kind: "thinking", contentIndex: 0, thinking: "Inspect." },
              {
                kind: "tool-call",
                contentIndex: 1,
                toolCallId: "tool_21" as ToolCallId,
                toolName: "exec_command",
                argumentsJson: '{"cmd":"bun test"}',
                argumentsStatus: "accepted",
                commandId: null,
              },
              { kind: "text", contentIndex: 2, text: "Done." },
            ],
            api: "openai-responses",
            providerId: "openai" as ProviderId,
            modelId: "gpt-5.5" as ModelId,
            responseId: "response_9",
            usage: {
              input: 10,
              output: 5,
              cacheRead: 2,
              cacheWrite: 0,
              totalTokens: 15,
              cost: { input: 0.1, output: 0.2, cacheRead: 0.01, cacheWrite: 0, total: 0.31 },
            },
            stopReason: "toolUse",
            errorMessage: null,
            piHistoryEntry: {
              session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
              entryId: "history_9",
            },
            messageTimestamp: "2026-07-11T12:00:00.000Z" as never,
            finishedAt: "2026-07-11T12:00:01.000Z" as never,
          },
        );

        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.tool_execution.updated",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            toolCallId: "tool_21",
            toolName: "exec_command",
            result: { details: { status: "succeeded", summary: "accepted" } },
          }),
          {
            type: "pi.tool_execution.updated",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            toolCallId: "tool_21" as ToolCallId,
            toolName: "exec_command",
            result: { details: { status: "succeeded", summary: "accepted" } },
          },
        );

        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.tool_execution.updated",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            toolCallId: "tool_21",
            toolName: "exec_command",
            update: {
              type: "progress",
              commandId: "cmd_21",
              message: "Halfway",
              occurredAt: "2026-07-01T12:00:00.000Z",
            },
          }),
          {
            type: "pi.tool_execution.updated",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            toolCallId: "tool_21" as ToolCallId,
            toolName: "exec_command",
            update: {
              type: "progress",
              commandId: "cmd_21" as never,
              message: "Halfway",
              occurredAt: "2026-07-01T12:00:00.000Z" as never,
            },
          },
        );

        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.tool_execution.finished",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            toolCallId: "tool_21",
            toolName: "exec_command",
            status: "completed",
            result: { details: { status: "succeeded", summary: "details only" } },
          }),
          {
            type: "pi.tool_execution.finished",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            toolCallId: "tool_21" as ToolCallId,
            toolName: "exec_command",
            status: "completed",
            result: { details: { status: "succeeded", summary: "details only" } },
          },
        );

        assert.deepStrictEqual(
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.agent.finished",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            status: "completed",
            stopReason: "stop",
          }),
          {
            type: "pi.agent.finished",
            session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
            turnId: "turn_01" as TurnId,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
            status: "completed",
            stopReason: "stop",
          },
        );

        assert.throws(() =>
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.tool_execution.finished",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            toolCallId: "tool_21",
            toolName: "exec_command",
            status: "completed",
            result: { details: { ok: true } },
          }),
        );

        assert.throws(() =>
          unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
            type: "pi.tool_call.arguments.delta",
            session: { surfacePiSessionId: "pi_surface_01" },
            turnId: "turn_01",
            surfacePiSessionId: "pi_surface_01",
            piMessageRef: "pi_msg_9",
            toolCallId: "tool_21",
            toolName: "exec_command",
            delta: "{}",
            contentIndex: 0,
            rendererOnly: true,
          }),
        );
      }),
  );

  it.effect("decodes closed pi-adapter state port input schemas", () =>
    Effect.gen(function* () {
      const reference = {
        surfacePiSessionId: "pi_surface_01",
        referenceFingerprint: "ref_fingerprint_01",
        adapterKind: "pi-coding-agent",
        adapterVersion: "1.0.0",
        storageLocator: "sessions/pi_surface_01.json",
        piSessionId: "native_pi_session_01",
        metadata: { title: "Investigate failure" },
      };

      assert.deepStrictEqual(
        yield* decodeUnknownGetPiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01",
        }),
        {
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
        },
      );
      assert.deepStrictEqual(
        yield* decodeUnknownSavePiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01",
          reference,
        }),
        {
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          reference: {
            ...reference,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          },
        },
      );
      assert.deepStrictEqual(
        yield* decodeUnknownValidatePiSessionReferenceInputEffect({
          workspaceId: "workspace_01",
          surfacePiSessionId: "pi_surface_01",
          actorKind: "orchestrator",
          reference,
        }),
        {
          workspaceId: "workspace_01" as WorkspaceId,
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          actorKind: "orchestrator",
          reference: {
            ...reference,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          },
        },
      );
      assert.deepStrictEqual(
        yield* decodeUnknownDeletePiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01",
        }),
        {
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
        },
      );
      assert.deepStrictEqual(
        yield* decodeUnknownResolvePiRuntimePathsInputEffect({
          workspaceId: "workspace_01",
        }),
        {
          workspaceId: "workspace_01" as WorkspaceId,
        },
      );
      yield* decodeUnknownResolvePiRuntimePathsInputEffect({
        workspaceId: "workspace_01",
        rendererOnly: true,
      }).pipe(Effect.flip);
      assert.deepStrictEqual(
        yield* encodeSavePiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          reference: {
            ...reference,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          },
        }),
        {
          surfacePiSessionId: "pi_surface_01",
          reference,
        },
      );
    }),
  );

  it.effect("defines core-owned Effect service tags for pi adapter dependencies", () =>
    Effect.gen(function* () {
      const providerAuthPort = {
        getProviderAuthSnapshot: () =>
          Effect.succeed({
            providerId: "openai" as ProviderId,
            health: "usable" as const,
            accessToken: Redacted.make("secret", { label: "provider-credential" }),
            credentialFingerprint: "provider_fingerprint_01",
          }),
        refreshProviderCredentialSnapshot: () =>
          Effect.succeed({
            providerId: "openai" as ProviderId,
            health: "usable" as const,
            accessToken: Redacted.make("secret", { label: "provider-credential" }),
            credentialFingerprint: "provider_fingerprint_01",
          }),
      } satisfies ProviderAuthPortService;
      const providerAuthStatusPort = {
        listProviderStatuses: () =>
          Effect.succeed([{ providerId: "openai" as ProviderId, health: "usable" as const }]),
        recordProviderStatus: (input) => Effect.succeed({ value: input.status, afterCommit: [] }),
      } satisfies ProviderAuthStatusStatePortService;
      const sessionReferencePort = {
        getPiSessionReference: () => Effect.succeed(undefined),
        savePiSessionReference: (input) =>
          Effect.succeed({ value: input.reference, afterCommit: [] }),
        deletePiSessionReference: (input) =>
          Effect.succeed({
            value: { surfacePiSessionId: input.surfacePiSessionId },
            afterCommit: [],
          }),
        validatePiSessionReference: () =>
          Effect.succeed({ valid: false as const, reason: "not-found" as const }),
      } satisfies PiSessionReferencePortService;
      const runtimePathsPort = {
        resolve: () =>
          Effect.succeed({
            workspaceId: "workspace_01" as WorkspaceId,
            cwd: "/tmp/workspace" as AbsolutePath,
            agentDir: "/tmp/svvy/pi" as AbsolutePath,
            sessionDir: "/tmp/svvy/pi/sessions" as AbsolutePath,
            modelRegistryPath: "/tmp/svvy/pi/models.json" as AbsolutePath,
            source: "test-fixture" as const,
          }),
      } satisfies PiRuntimePathsPortService;

      const result = yield* Effect.gen(function* () {
        const provider = yield* ProviderAuthPort;
        const references = yield* PiSessionReferencePort;
        const paths = yield* PiRuntimePathsPort;
        const providerStatus = yield* ProviderAuthStatusStatePort;
        return {
          auth: yield* provider.getProviderAuthSnapshot({
            providerId: "openai" as ProviderId,
          }),
          statuses: yield* providerStatus.listProviderStatuses({}),
          reference: yield* references.getPiSessionReference({
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          }),
          paths: yield* paths.resolve({ workspaceId: "workspace_01" as WorkspaceId }),
        };
      }).pipe(
        Effect.provideService(ProviderAuthPort, providerAuthPort),
        Effect.provideService(ProviderAuthStatusStatePort, providerAuthStatusPort),
        Effect.provideService(PiSessionReferencePort, sessionReferencePort),
        Effect.provideService(PiRuntimePathsPort, runtimePathsPort),
      );

      assert.strictEqual(result.auth.health, "usable");
      assert.deepStrictEqual(result.statuses, [
        { providerId: "openai" as ProviderId, health: "usable" },
      ]);
      assert.strictEqual(result.reference, undefined);
      assert.strictEqual(result.paths.modelRegistryPath, "/tmp/svvy/pi/models.json");
    }),
  );
});
