import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { runTestEffect } from "./effect.test-support";
import {
  decodeUnknownCreatePiSessionInputEffect,
  decodeUnknownInterruptPiTurnInputEffect,
  decodeUnknownListModelsInputEffect,
  decodeUnknownModelSelectionEffect,
  decodeNativeToolResult,
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
  it("defines pi-free turn input contracts from core ids, messages, and native tools", async () => {
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
        return Effect.succeed({ content: [{ type: "text", text: "ok" }], details: { ok: true } });
      },
      enabledAmbientPiResources: [
        {
          kind: "pi_builtin_tool",
          resourceId: "shell.exec",
          enabledByBindingFingerprint: "gctx_01" as GeneratedContextFingerprint,
        },
      ],
    } satisfies RunPiTurnInput;

    await expect(
      runTestEffect(
        input.toolExecutor({
          turnId: "turn_01" as TurnId,
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          piToolCallId: "tool_call_01" as ToolCallId,
          toolName: "exec_command",
          argumentsJson: '{"cmd":"pwd"}',
        }),
      ),
    ).resolves.toEqual({ content: [{ type: "text", text: "ok" }], details: { ok: true } });
    expect(input.model.providerId).toBe("openai" as ProviderId);
    expect(input.reasoning.effort).toBe("high");
    expect(input.userMessageSubmittedAt).toBe("2026-06-23T12:35:01.000Z");
    expect(input.enabledAmbientPiResources).toEqual([
      {
        kind: "pi_builtin_tool",
        resourceId: "shell.exec",
        enabledByBindingFingerprint: "gctx_01" as GeneratedContextFingerprint,
      },
    ]);
    expect(invoked).toEqual([
      {
        turnId: "turn_01",
        surfacePiSessionId: "pi_surface_01",
        piToolCallId: "tool_call_01",
        toolName: "exec_command",
        argumentsJson: '{"cmd":"pwd"}',
      },
    ]);
  });

  it("decodes closed model, reasoning, native-tool result, and pi runtime event schemas", async () => {
    await expect(
      runTestEffect(
        decodeUnknownModelSelectionEffect({ providerId: "openai", modelId: "gpt-5.5" }),
      ),
    ).resolves.toEqual({
      providerId: "openai" as ProviderId,
      modelId: "gpt-5.5" as ModelId,
    });
    await expect(
      runTestEffect(
        encodeModelSelectionEffect({
          providerId: "openai" as ProviderId,
          modelId: "gpt-5.5" as ModelId,
        }),
      ),
    ).resolves.toEqual({
      providerId: "openai",
      modelId: "gpt-5.5",
    });
    await expect(
      runTestEffect(decodeUnknownReasoningSelectionEffect({ effort: "xhigh" })),
    ).resolves.toEqual({
      effort: "xhigh",
    });
    await expect(
      runTestEffect(encodeReasoningSelectionEffect({ effort: "xhigh" })),
    ).resolves.toEqual({
      effort: "xhigh",
    });
    expect(
      decodeNativeToolResult({
        content: [{ type: "text", text: "ok" }],
        details: { status: "succeeded", summary: "ok" },
      }),
    ).toEqual({
      content: [{ type: "text", text: "ok" }],
      details: { status: "succeeded", summary: "ok" },
    });
    await expect(
      runTestEffect(
        decodeUnknownInterruptPiTurnInputEffect({
          surfacePiSessionId: "pi_surface_01",
          turnId: "turn_01",
        }),
      ),
    ).resolves.toEqual({
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      turnId: "turn_01" as TurnId,
    });
    await expect(
      runTestEffect(
        decodeUnknownInterruptPiTurnInputEffect({
          surfacePiSessionId: "pi_surface_01",
          turnId: "turn_01",
          rendererOnly: true,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runTestEffect(
        decodeUnknownCreatePiSessionInputEffect({
          workspaceId: "workspace_01",
          workspaceSessionId: "workspace_session_01",
          surfacePiSessionId: "pi_surface_01",
          actorKind: "orchestrator",
          agentProfileId: undefined,
          generatedContextFingerprint: "gctx_01",
          model: { providerId: "openai", modelId: "gpt-5.5" },
          reasoning: { effort: "high" },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runTestEffect(
        decodeUnknownListModelsInputEffect({
          workspaceId: "workspace_01",
          providerId: undefined,
        }),
      ),
    ).rejects.toThrow();
    expect(
      unsafeDecodePiRuntimeEventSyncForTestsAndBootstrap({
        type: "pi.assistant.text.delta",
        session: { surfacePiSessionId: "pi_surface_01" },
        turnId: "turn_01",
        surfacePiSessionId: "pi_surface_01",
        piMessageRef: "pi_msg_9",
        contentIndex: 0,
        delta: "",
      }),
    ).toEqual({
      type: "pi.assistant.text.delta",
      session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
      turnId: "turn_01" as TurnId,
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      piMessageRef: "pi_msg_9",
      contentIndex: 0,
      delta: "",
    });
    expect(
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
    ).toEqual({
      type: "pi.tool_call.arguments.delta",
      session: { surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId },
      turnId: "turn_01" as TurnId,
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      piMessageRef: "pi_msg_9",
      toolCallId: "tool_21" as ToolCallId,
      toolName: "exec_command",
      delta: '{"cmd":"bun run test:unit"',
      contentIndex: 0,
    });

    expect(() =>
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
    ).toThrow();
  });

  it("decodes closed pi-adapter state port input schemas", async () => {
    const reference = {
      surfacePiSessionId: "pi_surface_01",
      referenceFingerprint: "ref_fingerprint_01",
      adapterKind: "pi-coding-agent",
      adapterVersion: "1.0.0",
      storageLocator: "sessions/pi_surface_01.json",
      piSessionId: "native_pi_session_01",
      metadata: { title: "Investigate failure" },
    };

    await expect(
      runTestEffect(
        decodeUnknownGetPiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01",
        }),
      ),
    ).resolves.toEqual({
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
    });
    await expect(
      runTestEffect(
        decodeUnknownSavePiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01",
          reference,
        }),
      ),
    ).resolves.toEqual({
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      reference: {
        ...reference,
        surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      },
    });
    await expect(
      runTestEffect(
        decodeUnknownValidatePiSessionReferenceInputEffect({
          workspaceId: "workspace_01",
          surfacePiSessionId: "pi_surface_01",
          actorKind: "orchestrator",
          reference,
        }),
      ),
    ).resolves.toEqual({
      workspaceId: "workspace_01" as WorkspaceId,
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      actorKind: "orchestrator",
      reference: {
        ...reference,
        surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
      },
    });
    await expect(
      runTestEffect(
        decodeUnknownDeletePiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01",
        }),
      ),
    ).resolves.toEqual({
      surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
    });
    await expect(
      runTestEffect(
        decodeUnknownResolvePiRuntimePathsInputEffect({
          workspaceId: "workspace_01",
        }),
      ),
    ).resolves.toEqual({
      workspaceId: "workspace_01" as WorkspaceId,
    });
    await expect(
      runTestEffect(
        decodeUnknownResolvePiRuntimePathsInputEffect({
          workspaceId: "workspace_01",
          rendererOnly: true,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      runTestEffect(
        encodeSavePiSessionReferenceInputEffect({
          surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          reference: {
            ...reference,
            surfacePiSessionId: "pi_surface_01" as SurfacePiSessionId,
          },
        }),
      ),
    ).resolves.toEqual({
      surfacePiSessionId: "pi_surface_01",
      reference,
    });
  });

  it("defines core-owned Effect service tags for pi adapter dependencies", async () => {
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
          cwd: "/tmp/workspace",
          agentDir: "/tmp/svvy/pi",
          sessionDir: "/tmp/svvy/pi/sessions",
          modelRegistryPath: "/tmp/svvy/pi/models.json",
        }),
    } satisfies PiRuntimePathsPortService;

    const effect = Effect.gen(function* () {
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
    const result = await runTestEffect(effect);

    expect(result.auth.health).toBe("usable");
    expect(result.statuses).toEqual([{ providerId: "openai" as ProviderId, health: "usable" }]);
    expect(result.reference).toBeUndefined();
    expect(result.paths.modelRegistryPath).toBe("/tmp/svvy/pi/models.json");
  });
});
