import { assert, describe, it } from "@effect/vitest";
import {
  PiAdapterError,
  PiRuntimePathsPort,
  PiSessionReferencePort,
  ProviderAuthPort,
  ProviderAuthStatusStatePort,
  type NativeToolResult,
  type PiRuntimePathsSnapshot,
  type PiRuntimePathsPortService,
  type PiRuntimeEvent,
  type PiSessionReference,
  type PiSessionReferenceValidation,
  type PiSessionReferencePortService,
  type ProviderAuthPortService,
  type ProviderCredentialSnapshot,
  type ProviderAuthStatusStatePortService,
  type RunPiTurnInput,
  RuntimeToolExecutionError,
} from "@svvy/core";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { PiAdapter, layer } from "./index";
import {
  setPiManagedAgentSessionFactoryForTests,
  setPiTitleCompletionForTests,
} from "./pi-adapter";
import type { CreatePiManagedAgentSessionResult } from "./session";

const workspaceId = "workspace_test" as never;
const workspaceSessionId = "workspace_session_test" as never;
const surfacePiSessionId = "surface_pi_test" as never;
const openaiProviderId = "openai" as never;
const modelId = "gpt-5.5" as never;

const runtimePaths = {
  workspaceId,
  cwd: `/private/tmp/svvy-pi-adapter-test-${process.pid}`,
  agentDir: `/private/tmp/svvy-pi-adapter-test-${process.pid}/.svvy/pi`,
  sessionDir: `/private/tmp/svvy-pi-adapter-test-${process.pid}/.svvy/pi/sessions`,
  modelRegistryPath: `/private/tmp/svvy-pi-adapter-test-${process.pid}/.svvy/pi/models.json`,
  source: "test-fixture",
} as unknown as PiRuntimePathsSnapshot;

describe("PiAdapter", () => {
  it.effect("creates a scoped pi session reference through core-owned ports", () => {
    const savedReferences: PiSessionReference[] = [];
    const services = testPiAdapterServices({ savedReferences });
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const session = yield* adapter.sessions.create({
          workspaceId,
          workspaceSessionId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          generatedContextFingerprint: "gctx_test" as never,
          model: { providerId: openaiProviderId, modelId },
          reasoning: { effort: "high" },
        });

        assert.deepStrictEqual(session, { surfacePiSessionId });
        assert.strictEqual(savedReferences.length, 1);
        assert.deepStrictEqual(savedReferences[0], {
          surfacePiSessionId,
          referenceFingerprint: [
            "svvy-pi-adapter",
            "0.0.0",
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            "gctx_test",
          ].join(":"),
          adapterKind: "svvy-pi-adapter",
          adapterVersion: "0.0.0",
          storageLocator: `${runtimePaths.sessionDir}/${surfacePiSessionId}.jsonl`,
          metadata: {
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test",
            modelId,
            providerId: openaiProviderId,
            reasoningEffort: "high",
            workspaceId,
            workspaceSessionId,
          },
        });
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("refreshes an expired provider snapshot once before creating a session", () => {
    const refreshSnapshots: ProviderCredentialSnapshot[] = [
      {
        providerId: openaiProviderId,
        workspaceId,
        health: "usable",
        accessToken: Redacted.make("sk-refreshed") as never,
        credentialFingerprint: "credential_fingerprint_refreshed",
      },
    ];
    const savedReferences: PiSessionReference[] = [];
    const services = testPiAdapterServices({
      savedReferences,
      credentialSnapshot: {
        providerId: openaiProviderId,
        workspaceId,
        health: "expired",
        issue: "OpenAI credential expired.",
      },
      refreshCredentialSnapshot: () => refreshSnapshots.shift()!,
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const session = yield* adapter.sessions.create({
          workspaceId,
          workspaceSessionId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          generatedContextFingerprint: "gctx_test" as never,
          model: { providerId: openaiProviderId, modelId },
          reasoning: { effort: "high" },
        });

        assert.deepStrictEqual(session, { surfacePiSessionId });
        assert.strictEqual(savedReferences.length, 1);
        assert.strictEqual(refreshSnapshots.length, 0);
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("maps refreshed unusable provider snapshots to exact pi adapter auth errors", () => {
    const services = testPiAdapterServices({
      credentialSnapshot: {
        providerId: openaiProviderId,
        workspaceId,
        health: "expired",
        issue: "OpenAI credential expired.",
      },
      refreshCredentialSnapshot: () => ({
        providerId: openaiProviderId,
        workspaceId,
        health: "expired",
        issue: "OpenAI credential still expired.",
      }),
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const exit = yield* Effect.exit(
          adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          }),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "provider-auth-expired");
          assert.match(failure.message, /expired/);
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("opens an existing pi-free session reference after state validation", () => {
    const reference = testReference();
    const validatedReferences: PiSessionReference[] = [];
    const services = testPiAdapterServices({ validatedReferences });
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const session = yield* adapter.sessions.open({
          workspaceId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          expectedReference: reference,
        });

        assert.deepStrictEqual(session, { surfacePiSessionId });
        assert.deepStrictEqual(validatedReferences, [reference]);
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("maps missing pi session references to PiAdapterError", () => {
    const services = testPiAdapterServices();
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const exit = yield* Effect.exit(
          adapter.sessions.open({
            workspaceId,
            surfacePiSessionId,
            actorKind: "orchestrator",
          }),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "session-not-found");
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("closes sessions without deleting persisted references", () => {
    let deleteCalls = 0;
    const services = testPiAdapterServices({
      onDeleteReference: () => {
        deleteCalls += 1;
      },
    });
    return Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      yield* adapter.sessions.close({ session: { surfacePiSessionId } });

      assert.strictEqual(deleteCalls, 0);
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(ProviderAuthPort, services.providerAuthPort),
      Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
      Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
    );
  });

  it.effect("fails turn execution when the pi session has no scoped live handle", () => {
    const services = testPiAdapterServices();
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const exit = yield* Effect.exit(
          adapter.turns.run({
            session: { surfacePiSessionId },
            turnId: "turn_test" as never,
            surfacePiSessionId,
            userMessage: { text: "Hello" },
            userMessageSubmittedAt: "2026-07-01T12:00:00.000Z" as never,
            systemPromptBinding: {
              fingerprint: "gctx_test" as never,
              revision: "gctx_rev_test" as never,
              text: "You are svvy.",
            },
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
            tools: [],
            toolExecutor: () => Effect.die("unused"),
          }),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "session-not-found");
        }
      }),
    ).pipe(
      Effect.provide(layer),
      Effect.provideService(ProviderAuthPort, services.providerAuthPort),
      Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
      Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
    );
  });

  it.effect("fails turn interruption when the pi session has no scoped live handle", () => {
    const services = testPiAdapterServices();
    return Effect.gen(function* () {
      const adapter = yield* PiAdapter;
      const exit = yield* Effect.exit(
        adapter.turns.interrupt({
          surfacePiSessionId,
          turnId: "turn_test" as never,
        }),
      );

      assert.strictEqual(exit._tag, "Failure");
      if (exit._tag === "Failure") {
        const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
        assert.ok(failure instanceof PiAdapterError);
        assert.strictEqual(failure.reason, "session-not-found");
      }
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(ProviderAuthPort, services.providerAuthPort),
      Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
      Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
    );
  });

  it.effect("validates the persisted reference before interrupting a scoped live session", () => {
    const validatedReferences: PiSessionReference[] = [];
    const services = testPiAdapterServices({ validatedReferences });
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        yield* adapter.sessions.create({
          workspaceId,
          workspaceSessionId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          generatedContextFingerprint: "gctx_test" as never,
          model: { providerId: openaiProviderId, modelId },
          reasoning: { effort: "high" },
        });

        const exit = yield* Effect.exit(
          adapter.turns.interrupt({
            surfacePiSessionId,
            turnId: "turn_test" as never,
          }),
        );

        assert.strictEqual(validatedReferences.length, 1);
        assert.strictEqual(validatedReferences[0]?.surfacePiSessionId, surfacePiSessionId);
        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "turn-not-active");
          assert.match(failure.message, /no active turn/);
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("removes live session handles on close", () => {
    const services = testPiAdapterServices();
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const session = yield* adapter.sessions.create({
          workspaceId,
          workspaceSessionId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          generatedContextFingerprint: "gctx_test" as never,
          model: { providerId: openaiProviderId, modelId },
          reasoning: { effort: "high" },
        });

        yield* adapter.sessions.close({ session });
        const exit = yield* Effect.exit(
          adapter.turns.run(testRunTurnInput({ turnId: "turn_after_close" as never })),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "session-not-found");
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("runs and interrupts an active turn through the managed pi session seam", () => {
    const validatedReferences: PiSessionReference[] = [];
    const services = testPiAdapterServices({ validatedReferences });
    const promptCalls: Array<{ readonly text: string; readonly options: unknown }> = [];
    let abortCalls = 0;
    let disposeCalls = 0;
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async (input) => {
      assert.strictEqual(input.cwd, runtimePaths.cwd);
      assert.strictEqual(input.agentDir, runtimePaths.agentDir);
      assert.strictEqual(input.provider, openaiProviderId);
      assert.strictEqual(input.model, modelId);
      assert.strictEqual(input.thinkingLevel, "high" as never);
      assert.strictEqual(input.systemPrompt, "You are svvy.");
      input.syncAuthStorage?.({
        setRuntimeApiKey: (providerId: string, apiKey: string) => {
          assert.strictEqual(providerId, openaiProviderId);
          assert.strictEqual(apiKey, "sk-test");
        },
      } as never);
      return testManagedAgentSession({
        promptCalls,
        onAbort: async () => {
          abortCalls += 1;
        },
        onDispose: () => {
          disposeCalls += 1;
        },
        promptSettles: false,
      });
    });
    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          const turn = yield* adapter.turns.run(
            testRunTurnInput({ turnId: "turn_active" as never }),
          );
          assert.deepStrictEqual(promptCalls, [
            { text: "Hello", options: { expandPromptTemplates: false } },
          ]);

          yield* adapter.turns.interrupt({
            surfacePiSessionId,
            turnId: "turn_active" as never,
          });
          assert.strictEqual(abortCalls, 1);
          assert.strictEqual(validatedReferences.length, 2);

          yield* turn.close();
          assert.strictEqual(disposeCalls, 1);
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("interrupt terminalizes a hung prompt turn exactly once", () => {
    const services = testPiAdapterServices();
    let abortCalls = 0;
    let disposeCalls = 0;
    let resolvePrompt: (() => void) | undefined;
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async () =>
      testManagedAgentSession({
        onAbort: async () => {
          abortCalls += 1;
        },
        onDispose: () => {
          disposeCalls += 1;
        },
        onPrompt: () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      }),
    );

    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          const turn = yield* adapter.turns.run(
            testRunTurnInput({ turnId: "turn_hung_prompt" as never }),
          );
          const terminalFiber = yield* turn.stream.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.forkScoped,
          );

          yield* adapter.turns.interrupt({
            surfacePiSessionId,
            turnId: "turn_hung_prompt" as never,
          });
          const events = Array.from(yield* Fiber.join(terminalFiber));

          assert.deepStrictEqual(events, [
            {
              session: { surfacePiSessionId },
              turnId: "turn_hung_prompt" as never,
              surfacePiSessionId,
              type: "pi.agent.finished",
              status: "cancelled",
              stopReason: "interrupted",
            },
          ]);
          assert.strictEqual(abortCalls, 1);

          resolvePrompt?.();
          yield* Effect.promise(() => Promise.resolve());
          const secondInterrupt = yield* Effect.exit(
            adapter.turns.interrupt({
              surfacePiSessionId,
              turnId: "turn_hung_prompt" as never,
            }),
          );
          assert.strictEqual(secondInterrupt._tag, "Failure");
          if (secondInterrupt._tag === "Failure") {
            const failure = secondInterrupt.cause.reasons.find(
              (reason) => reason._tag === "Fail",
            )?.error;
            assert.ok(failure instanceof PiAdapterError);
            assert.strictEqual(failure.reason, "turn-already-terminal");
          }
          assert.strictEqual(abortCalls, 1);
          assert.strictEqual(disposeCalls, 1);
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("drains pending subscription offers before prompt close shuts the turn queue", () => {
    const services = testPiAdapterServices();
    let listener: ((event: unknown) => void) | undefined;
    let resolvePrompt: (() => void) | undefined;
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async () =>
      testManagedAgentSession({
        onSubscribe: (nextListener) => {
          listener = nextListener;
        },
        onPrompt: () =>
          new Promise<void>((resolve) => {
            resolvePrompt = resolve;
          }),
      }),
    );

    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          const turn = yield* adapter.turns.run(
            testRunTurnInput({ turnId: "turn_offer_drain" as never }),
          );
          assert.ok(listener);

          for (let index = 0; index < 256; index += 1) {
            listener!({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                contentIndex: index,
                partial: { id: `msg_${index}` },
                delta: `${index}`,
              },
            });
          }
          listener!({ type: "agent_end", messages: [] });
          resolvePrompt?.();

          const events = Array.from(
            yield* turn.stream.pipe(Stream.take(257), Stream.runCollect),
          ) as PiRuntimeEvent[];
          const terminalEvents = events.filter((event) => event.type === "pi.agent.finished");

          assert.strictEqual(events.length, 257);
          assert.deepStrictEqual(terminalEvents, [
            {
              session: { surfacePiSessionId },
              turnId: "turn_offer_drain" as never,
              surfacePiSessionId,
              type: "pi.agent.finished",
              status: "completed",
            },
          ]);
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect(
    "uses the Effect clock for lifecycle events and preserves pi history enrichment",
    () => {
      const services = testPiAdapterServices();
      let listener: ((event: unknown) => void) | undefined;
      let leafEntry: unknown;
      const restoreFactory = setPiManagedAgentSessionFactoryForTests(async () =>
        testManagedAgentSession({
          onSubscribe: (nextListener) => {
            listener = nextListener;
          },
          promptSettles: false,
          readLeafEntry: () => leafEntry,
        }),
      );

      return Effect.scoped(
        Effect.gen(function* () {
          try {
            yield* TestClock.setTime(Date.parse("2026-07-11T12:00:01.000Z"));
            const adapter = yield* PiAdapter;
            yield* adapter.sessions.create({
              workspaceId,
              workspaceSessionId,
              surfacePiSessionId,
              actorKind: "orchestrator",
              generatedContextFingerprint: "gctx_test" as never,
              model: { providerId: openaiProviderId, modelId },
              reasoning: { effort: "high" },
            });

            const turnId = "turn_lifecycle_clock" as never;
            const turn = yield* adapter.turns.run(testRunTurnInput({ turnId }));
            const eventFiber = yield* turn.stream.pipe(
              Stream.take(2),
              Stream.runCollect,
              Effect.forkScoped,
            );
            assert.ok(listener);

            listener!({
              type: "message_start",
              message: {
                role: "assistant",
                content: [],
                api: "openai-responses",
                provider: "openai",
                model: "gpt-5.5",
              },
            });

            yield* TestClock.setTime(Date.parse("2026-07-11T12:00:02.000Z"));
            const assistantMessage = {
              role: "assistant",
              content: [{ type: "text", text: "Done." }],
              api: "openai-responses",
              provider: "openai",
              model: "gpt-5.5",
              usage: {
                input: 2,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 3,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
              },
              stopReason: "stop",
              timestamp: 1710000000000,
            };
            listener!({ type: "message_end", message: assistantMessage });
            leafEntry = {
              type: "message",
              id: "pi_entry_assistant_clock",
              message: assistantMessage,
            };

            const events = Array.from(yield* Fiber.join(eventFiber));
            const started = events.find((event) => event.type === "pi.assistant_message.started");
            const committed = events.find(
              (event) => event.type === "pi.assistant_message.committed",
            );
            assert.ok(started && started.type === "pi.assistant_message.started");
            assert.ok(committed && committed.type === "pi.assistant_message.committed");
            assert.strictEqual(started.startedAt, "2026-07-11T12:00:01.000Z");
            assert.strictEqual(committed.finishedAt, "2026-07-11T12:00:02.000Z");
            assert.strictEqual(committed.messageTimestamp, "2024-03-09T16:00:00.000Z");
            assert.deepStrictEqual(committed.piHistoryEntry, {
              session: { surfacePiSessionId },
              entryId: "pi_entry_assistant_clock",
            });
            assert.strictEqual(committed.piMessageRef, started.piMessageRef);

            yield* turn.close();
          } finally {
            restoreFactory();
          }
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(ProviderAuthPort, services.providerAuthPort),
          Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
          Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
        ),
      );
    },
  );

  it.effect("interrupt settles when the turn queue is saturated without a consumer", () => {
    const services = testPiAdapterServices();
    let listener: ((event: unknown) => void) | undefined;
    let abortCalls = 0;
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async () =>
      testManagedAgentSession({
        onSubscribe: (nextListener) => {
          listener = nextListener;
        },
        onAbort: async () => {
          abortCalls += 1;
        },
        promptSettles: false,
      }),
    );

    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          yield* adapter.turns.run(
            testRunTurnInput({ turnId: "turn_saturated_interrupt" as never }),
          );
          assert.ok(listener);

          for (let index = 0; index < 300; index += 1) {
            listener!({
              type: "message_update",
              assistantMessageEvent: {
                type: "text_delta",
                contentIndex: index,
                partial: { id: `msg_${index}` },
                delta: `${index}`,
              },
            });
          }
          yield* flushPromiseTurns(300);

          const result = yield* adapter.turns
            .interrupt({
              surfacePiSessionId,
              turnId: "turn_saturated_interrupt" as never,
            })
            .pipe(
              Effect.as("settled" as const),
              Effect.timeoutOrElse({
                duration: 100,
                orElse: () => Effect.succeed("timed-out" as const),
              }),
            );

          assert.strictEqual(result, "settled");
          assert.strictEqual(abortCalls, 1);
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("interrupts in-flight custom tool effects before they return to pi", () => {
    const services = testPiAdapterServices();
    let runToolEffect:
      | Parameters<
          Parameters<typeof setPiManagedAgentSessionFactoryForTests>[0]
        >[0]["runToolEffect"]
      | undefined;
    const toolResults: unknown[] = [];
    const toolErrors: unknown[] = [];
    let toolStarted = false;
    let toolInterrupted = false;
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async (input) => {
      runToolEffect = input.runToolEffect;
      return testManagedAgentSession({ promptSettles: false });
    });

    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          yield* adapter.turns.run(testRunTurnInput({ turnId: "turn_tool_cancel" as never }));
          assert.ok(runToolEffect);

          const toolPromise = runToolEffect!(
            Effect.tryPromise({
              try: (signal) => {
                toolStarted = true;
                signal.addEventListener("abort", () => {
                  toolInterrupted = true;
                });
                return new Promise<never>(() => {});
              },
              catch: (cause) =>
                new RuntimeToolExecutionError({
                  turnId: "turn_tool_cancel" as never,
                  surfacePiSessionId,
                  piToolCallId: "tool_call_cancel" as never,
                  toolName: "example_tool",
                  reason: "cancelled",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            }),
          ).then(
            (result) => {
              toolResults.push(result);
            },
            (error) => {
              toolErrors.push(error);
            },
          );
          yield* Effect.promise(() => Promise.resolve());
          assert.strictEqual(toolStarted, true);

          yield* adapter.turns.interrupt({
            surfacePiSessionId,
            turnId: "turn_tool_cancel" as never,
          });
          yield* Effect.promise(() => toolPromise);

          assert.strictEqual(toolInterrupted, true);
          assert.deepStrictEqual(toolResults, []);
          assert.strictEqual(toolErrors.length, 1);
          assert.ok(toolErrors[0] instanceof PiAdapterError);
          assert.strictEqual((toolErrors[0] as PiAdapterError).reason, "turn-not-active");
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("rejects tool success that races with turn abort", () => {
    const services = testPiAdapterServices();
    let runToolEffect:
      | Parameters<
          Parameters<typeof setPiManagedAgentSessionFactoryForTests>[0]
        >[0]["runToolEffect"]
      | undefined;
    let resolveAbort: (() => void) | undefined;
    const toolResults: unknown[] = [];
    const toolErrors: unknown[] = [];
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async (input) => {
      runToolEffect = input.runToolEffect;
      return testManagedAgentSession({
        promptSettles: false,
        onAbort: () =>
          new Promise<void>((resolve) => {
            resolveAbort = resolve;
          }),
      });
    });

    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          yield* adapter.turns.run(
            testRunTurnInput({ turnId: "turn_tool_abort_success" as never }),
          );
          assert.ok(runToolEffect);

          const toolPromise = runToolEffect!(
            Effect.tryPromise({
              try: (signal) =>
                new Promise<NativeToolResult>((resolve) => {
                  signal.addEventListener("abort", () => {
                    resolve({ content: [{ type: "text", text: "late success" }] });
                  });
                }),
              catch: (cause) =>
                new RuntimeToolExecutionError({
                  turnId: "turn_tool_abort_success" as never,
                  surfacePiSessionId,
                  piToolCallId: "tool_call_abort_success" as never,
                  toolName: "example_tool",
                  reason: "cancelled",
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            }),
          ).then(
            (result) => {
              toolResults.push(result);
            },
            (error) => {
              toolErrors.push(error);
            },
          );
          yield* Effect.promise(() => Promise.resolve());

          const interruptFiber = yield* adapter.turns
            .interrupt({
              surfacePiSessionId,
              turnId: "turn_tool_abort_success" as never,
            })
            .pipe(Effect.forkScoped);
          yield* flushPromiseTurns(5);
          yield* Effect.promise(() => toolPromise);

          assert.deepStrictEqual(toolResults, []);
          assert.strictEqual(toolErrors.length, 1);
          assert.ok(toolErrors[0] instanceof PiAdapterError);
          assert.strictEqual((toolErrors[0] as PiAdapterError).reason, "turn-not-active");

          resolveAbort?.();
          yield* Fiber.join(interruptFiber);
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("streams executor-emitted structured tool updates through the turn queue", () => {
    const services = testPiAdapterServices();
    let emitToolExecutionUpdate:
      | Parameters<
          Parameters<typeof setPiManagedAgentSessionFactoryForTests>[0]
        >[0]["emitToolExecutionUpdate"]
      | undefined;
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async (input) => {
      emitToolExecutionUpdate = input.emitToolExecutionUpdate;
      return testManagedAgentSession({ promptSettles: false });
    });

    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });

          const turn = yield* adapter.turns.run(
            testRunTurnInput({ turnId: "turn_tool_update" as never }),
          );
          assert.ok(emitToolExecutionUpdate);

          yield* emitToolExecutionUpdate!({
            turnId: "turn_tool_update" as never,
            surfacePiSessionId,
            piToolCallId: "tool_call_update" as never,
            toolName: "exec_command",
            update: {
              type: "progress",
              commandId: "command_tool_update" as never,
              message: "Halfway",
              occurredAt: "2026-07-01T12:00:00.000Z" as never,
            },
          });

          const events = yield* turn.stream.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.map((chunk) => Array.from(chunk)),
          );

          assert.deepStrictEqual(events, [
            {
              session: { surfacePiSessionId },
              turnId: "turn_tool_update" as never,
              surfacePiSessionId,
              type: "pi.tool_execution.updated",
              toolCallId: "tool_call_update" as never,
              toolName: "exec_command",
              update: {
                type: "progress",
                commandId: "command_tool_update" as never,
                message: "Halfway",
                occurredAt: "2026-07-01T12:00:00.000Z" as never,
              },
            },
          ]);

          yield* turn.close();
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("rejects a second active turn without submitting a second prompt", () => {
    const services = testPiAdapterServices();
    const promptCalls: Array<{ readonly text: string; readonly options: unknown }> = [];
    const restoreFactory = setPiManagedAgentSessionFactoryForTests(async () =>
      testManagedAgentSession({ promptCalls, promptSettles: false }),
    );
    return Effect.scoped(
      Effect.gen(function* () {
        try {
          const adapter = yield* PiAdapter;
          yield* adapter.sessions.create({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            actorKind: "orchestrator",
            generatedContextFingerprint: "gctx_test" as never,
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
          });
          const turn = yield* adapter.turns.run(testRunTurnInput({ turnId: "turn_one" as never }));

          const exit = yield* Effect.exit(
            adapter.turns.run(testRunTurnInput({ turnId: "turn_two" as never })),
          );

          assert.strictEqual(exit._tag, "Failure");
          if (exit._tag === "Failure") {
            const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
            assert.ok(failure instanceof PiAdapterError);
            assert.strictEqual(failure.reason, "active-turn-running");
          }
          assert.strictEqual(promptCalls.length, 1);
          yield* turn.close();
        } finally {
          restoreFactory();
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("rejects turn execution when the scoped live session reference is invalid", () => {
    const services = testPiAdapterServices({
      validateReference: (reference) => ({
        valid: false,
        reason: "actor-mismatch",
        referenceFingerprint: reference.referenceFingerprint,
      }),
    });
    return Effect.scoped(
      Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        yield* adapter.sessions.create({
          workspaceId,
          workspaceSessionId,
          surfacePiSessionId,
          actorKind: "orchestrator",
          generatedContextFingerprint: "gctx_test" as never,
          model: { providerId: openaiProviderId, modelId },
          reasoning: { effort: "high" },
        });

        const exit = yield* Effect.exit(
          adapter.turns.run({
            session: { surfacePiSessionId },
            turnId: "turn_test" as never,
            surfacePiSessionId,
            userMessage: { text: "Hello" },
            userMessageSubmittedAt: "2026-07-01T12:00:00.000Z" as never,
            systemPromptBinding: {
              fingerprint: "gctx_test" as never,
              revision: "gctx_rev_test" as never,
              text: "You are svvy.",
            },
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "high" },
            tools: [],
            toolExecutor: () => Effect.die("unused"),
          }),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "session-open-failed");
          assert.match(failure.message, /actor-mismatch/);
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        Effect.provideService(PiSessionReferencePort, services.sessionReferencePort),
      ),
    );
  });

  it.effect("lists pi model metadata with provider auth status", () =>
    Effect.gen(function* () {
      const providerAuthStatus = {
        listProviderStatuses: () =>
          Effect.succeed([
            {
              providerId: openaiProviderId,
              workspaceId,
              health: "usable",
              redactedAccountLabel: "OpenAI key",
            },
          ]),
        recordProviderStatus: () => Effect.die("unused"),
      } satisfies ProviderAuthStatusStatePortService;

      const models = yield* Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        return yield* adapter.models.list({
          workspaceId,
          providerId: openaiProviderId,
        });
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthStatusStatePort, providerAuthStatus),
      );

      assert.ok(models.length > 0);
      assert.strictEqual(
        models.every((model) => model.providerId === "openai"),
        true,
      );
      assert.deepStrictEqual(models[0]?.authStatus, {
        providerId: openaiProviderId,
        workspaceId,
        health: "usable",
        redactedAccountLabel: "OpenAI key",
      });
      assert.strictEqual(
        models.some((model) => model.inputModalities.includes("text")),
        true,
      );
      assert.strictEqual(
        models.some((model) => model.supportedReasoning.includes("off")),
        true,
      );
    }),
  );

  it.effect("marks providers missing when auth status is absent", () =>
    Effect.gen(function* () {
      const providerAuthStatus = {
        listProviderStatuses: () => Effect.succeed([]),
        recordProviderStatus: () => Effect.die("unused"),
      } satisfies ProviderAuthStatusStatePortService;

      const models = yield* Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        return yield* adapter.models.list({
          workspaceId,
          providerId: openaiProviderId,
        });
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthStatusStatePort, providerAuthStatus),
      );

      assert.ok(models.length > 0);
      assert.deepStrictEqual(models[0]?.authStatus, {
        providerId: openaiProviderId,
        workspaceId,
        health: "missing",
      });
    }),
  );

  it.effect("generates titles through an operation-scoped helper job", () => {
    const services = testPiAdapterServices();
    const restoreCompletion = setPiTitleCompletionForTests(async (input) => {
      assert.strictEqual(input.prompt, "First user message:\nImplement runtime queue wakeups.");
      assert.strictEqual(input.model.provider, openaiProviderId);
      assert.strictEqual(input.model.id, modelId);
      assert.strictEqual(input.apiKey, "sk-test");
      assert.deepStrictEqual(input.reasoning, { effort: "low" });
      assert.strictEqual(input.signal.aborted, false);
      return {
        role: "assistant",
        content: [{ type: "text", text: '"Runtime Queue Wakeups."' }],
        api: "openai-responses",
        provider: openaiProviderId,
        model: modelId,
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      } as never;
    });
    return Effect.gen(function* () {
      try {
        const result = yield* Effect.gen(function* () {
          const adapter = yield* PiAdapter;
          return yield* adapter.helperJobs.generateTitle({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            prompt: "First user message:\nImplement runtime queue wakeups.",
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "low" },
          });
        }).pipe(
          Effect.provide(layer),
          Effect.provideService(ProviderAuthPort, services.providerAuthPort),
          Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
        );

        assert.deepStrictEqual(result, {
          title: "Runtime queue wakeups",
          model: { providerId: openaiProviderId, modelId },
        });
      } finally {
        restoreCompletion();
      }
    });
  });

  it.effect(
    "fails title helper jobs on unusable provider credentials before opening pi sessions",
    () => {
      const services = testPiAdapterServices({
        credentialSnapshot: {
          providerId: openaiProviderId,
          workspaceId,
          health: "missing",
          issue: "OpenAI credential missing.",
        },
      });
      return Effect.gen(function* () {
        const adapter = yield* PiAdapter;
        const exit = yield* Effect.exit(
          adapter.helperJobs.generateTitle({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            prompt: "First user message:\nImplement runtime queue wakeups.",
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "low" },
          }),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "provider-auth-missing");
        }
      }).pipe(
        Effect.provide(layer),
        Effect.provideService(ProviderAuthPort, services.providerAuthPort),
        Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
      );
    },
  );

  it.effect("rejects empty and generic title helper results", () => {
    const services = testPiAdapterServices();
    const restoreCompletion = setPiTitleCompletionForTests(
      async () =>
        ({
          role: "assistant",
          content: [{ type: "text", text: "Session" }],
          api: "openai-responses",
          provider: openaiProviderId,
          model: modelId,
          usage: {
            input: 1,
            output: 1,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: "stop",
          timestamp: 0,
        }) as never,
    );
    return Effect.gen(function* () {
      try {
        const adapter = yield* PiAdapter;
        const exit = yield* Effect.exit(
          adapter.helperJobs.generateTitle({
            workspaceId,
            workspaceSessionId,
            surfacePiSessionId,
            prompt: "First user message:\nImplement runtime queue wakeups.",
            model: { providerId: openaiProviderId, modelId },
            reasoning: { effort: "low" },
          }),
        );

        assert.strictEqual(exit._tag, "Failure");
        if (exit._tag === "Failure") {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error;
          assert.ok(failure instanceof PiAdapterError);
          assert.strictEqual(failure.reason, "helper-job-failed");
          assert.match(failure.message, /generic title/);
        }
      } finally {
        restoreCompletion();
      }
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(ProviderAuthPort, services.providerAuthPort),
      Effect.provideService(PiRuntimePathsPort, services.runtimePathsPort),
    );
  });
});

function testRunTurnInput(input: { readonly turnId: RunPiTurnInput["turnId"] }): RunPiTurnInput {
  return {
    session: { surfacePiSessionId },
    turnId: input.turnId,
    surfacePiSessionId,
    userMessage: { text: "Hello" },
    userMessageSubmittedAt: "2026-07-01T12:00:00.000Z" as never,
    systemPromptBinding: {
      fingerprint: "gctx_test" as never,
      revision: "gctx_rev_test" as never,
      text: "You are svvy.",
    },
    model: { providerId: openaiProviderId, modelId },
    reasoning: { effort: "high" },
    tools: [],
    toolExecutor: () => Effect.die("unused"),
  };
}

function testManagedAgentSession(
  options: {
    readonly promptCalls?: Array<{ readonly text: string; readonly options: unknown }>;
    readonly promptSettles?: boolean;
    readonly onPrompt?: (text: string, promptOptions: unknown) => Promise<void>;
    readonly onSubscribe?: (listener: (event: unknown) => void) => void;
    readonly readLeafEntry?: () => unknown;
    readonly onAbort?: () => Promise<void>;
    readonly onDispose?: () => void;
  } = {},
): CreatePiManagedAgentSessionResult {
  return {
    session: {
      subscribe: (listener: (event: unknown) => void) => {
        options.onSubscribe?.(listener);
        return () => {};
      },
      prompt: (text: string, promptOptions: unknown) => {
        options.promptCalls?.push({ text, options: promptOptions });
        if (options.onPrompt) {
          return options.onPrompt(text, promptOptions);
        }
        return options.promptSettles === false ? new Promise<void>(() => {}) : Promise.resolve();
      },
      abort: () => options.onAbort?.() ?? Promise.resolve(),
      dispose: () => options.onDispose?.(),
      sessionManager: {
        getLeafEntry: () => options.readLeafEntry?.(),
      },
    } as never,
    authStorage: {} as never,
    modelRegistry: {} as never,
    activeModel: {} as never,
  };
}

function flushPromiseTurns(count: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let index = 0; index < count; index += 1) {
      yield* Effect.promise(() => Promise.resolve());
    }
  });
}

function testReference(): PiSessionReference {
  return {
    surfacePiSessionId,
    referenceFingerprint: "reference-test",
    adapterKind: "svvy-pi-adapter",
    adapterVersion: "0.0.0",
    storageLocator: `${runtimePaths.sessionDir}/${surfacePiSessionId}`,
    metadata: {
      providerId: openaiProviderId,
    },
  };
}

function testPiAdapterServices(
  options: {
    readonly savedReferences?: PiSessionReference[];
    readonly validatedReferences?: PiSessionReference[];
    readonly onDeleteReference?: () => void;
    readonly validateReference?: (reference: PiSessionReference) => PiSessionReferenceValidation;
    readonly credentialSnapshot?: ProviderCredentialSnapshot;
    readonly refreshCredentialSnapshot?: () => ProviderCredentialSnapshot;
  } = {},
) {
  const providerAuthPort = {
    getProviderAuthSnapshot: () =>
      Effect.succeed(
        options.credentialSnapshot ?? {
          providerId: openaiProviderId,
          workspaceId,
          health: "usable",
          accessToken: Redacted.make("sk-test") as never,
          credentialFingerprint: "credential_fingerprint_test",
        },
      ),
    refreshProviderCredentialSnapshot: () =>
      Effect.sync(
        () =>
          options.refreshCredentialSnapshot?.() ??
          options.credentialSnapshot ?? {
            providerId: openaiProviderId,
            workspaceId,
            health: "usable",
            accessToken: Redacted.make("sk-test") as never,
            credentialFingerprint: "credential_fingerprint_test",
          },
      ),
  } satisfies ProviderAuthPortService;
  const runtimePathsPort = {
    resolve: () => Effect.succeed(runtimePaths),
  } satisfies PiRuntimePathsPortService;
  const sessionReferencePort = {
    getPiSessionReference: () => Effect.succeed(undefined),
    savePiSessionReference: (input) =>
      Effect.sync(() => {
        options.savedReferences?.push(input.reference);
        return { value: input.reference, afterCommit: [] };
      }),
    deletePiSessionReference: (input) =>
      Effect.sync(() => {
        options.onDeleteReference?.();
        return { value: { surfacePiSessionId: input.surfacePiSessionId }, afterCommit: [] };
      }),
    validatePiSessionReference: (input) =>
      Effect.sync(() => {
        options.validatedReferences?.push(input.reference);
        return (
          options.validateReference?.(input.reference) ?? {
            valid: true,
            reference: input.reference,
            referenceFingerprint: input.reference.referenceFingerprint,
          }
        );
      }),
  } satisfies PiSessionReferencePortService;

  return { providerAuthPort, runtimePathsPort, sessionReferencePort };
}
