import { assert, describe, it } from "@effect/vitest";
import {
  type NativeToolDeclaration,
  type PiToolExecutionUpdate,
  type PiToolExecutor,
  type SurfacePiSessionId,
  type TurnId,
} from "@svvy/core";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as Effect from "effect/Effect";
import { createPiCustomToolDefinitions } from "./native-tools";

const declaration: NativeToolDeclaration = {
  name: "example_tool",
  label: "Example Tool",
  description: "Runs an example native tool.",
  parameters: { type: "object" },
};

describe("createPiCustomToolDefinitions Effect bridge", () => {
  it.effect(
    "adapts svvy native tool declarations and one Effect executor to pi custom tool definitions",
    () =>
      Effect.gen(function* () {
        const executions: unknown[] = [];
        const hostRunnerInputs: unknown[] = [];
        const executor: PiToolExecutor = (input) => {
          executions.push(input);
          return Effect.succeed({
            content: [{ type: "text", text: "done" }],
          });
        };

        const [tool] = createPiCustomToolDefinitions(
          [declaration],
          executor,
          async (effect) => {
            hostRunnerInputs.push(effect);
            return {
              content: [{ type: "text", text: "done" }],
              details: { commandFacts: { step: 2 } },
            };
          },
          () => Effect.void,
          (input) => ({
            turnId: "turn-1" as TurnId,
            surfacePiSessionId: "surface-1" as SurfacePiSessionId,
            observedToolCallId: input.piToolCallId,
          }),
        );

        assert.deepStrictEqual(
          {
            name: tool?.name,
            label: tool?.label,
            description: tool?.description,
            parameters: tool?.parameters,
            hasPrepareArguments: Object.hasOwn(tool ?? {}, "prepareArguments"),
          },
          {
            name: "example_tool",
            label: "Example Tool",
            description: "Runs an example native tool.",
            parameters: { type: "object" },
            hasPrepareArguments: false,
          },
        );

        const result = yield* Effect.promise(() =>
          tool!.execute(
            "tool-call-1",
            { value: "input" },
            undefined,
            undefined,
            {} as ExtensionContext,
          ),
        );

        assert.deepStrictEqual(executions, [
          {
            turnId: "turn-1",
            surfacePiSessionId: "surface-1",
            piToolCallId: "tool-call-1",
            toolName: "example_tool",
            argumentsJson: '{"value":"input"}',
            emit: executions[0] && (executions[0] as { emit: unknown }).emit,
          },
        ]);
        assert.strictEqual(typeof (executions[0] as { emit?: unknown }).emit, "function");
        assert.strictEqual(hostRunnerInputs.length, 1);
        assert.deepStrictEqual(result, {
          content: [{ type: "text", text: "done" }],
          details: { commandFacts: { step: 2 } },
        });
      }),
  );

  it.effect("passes undefined pi tool params as explicit null JSON", () =>
    Effect.gen(function* () {
      const executions: unknown[] = [];
      const [tool] = createPiCustomToolDefinitions(
        [
          {
            name: "no_arg_tool",
            label: "No Arg Tool",
            description: "Runs without arguments.",
            parameters: { type: "object" },
          },
        ],
        (input) => {
          executions.push(input);
          return Effect.succeed({ content: [{ type: "text", text: "done" }] });
        },
        async () => ({ content: [{ type: "text", text: "done" }] }),
        () => Effect.void,
        (input) => ({
          turnId: "turn-1" as TurnId,
          surfacePiSessionId: "surface-1" as SurfacePiSessionId,
          observedToolCallId: input.piToolCallId,
        }),
      );

      yield* Effect.promise(() =>
        tool!.execute("tool-call-1", undefined, undefined, undefined, {} as ExtensionContext),
      );

      assert.deepStrictEqual(executions, [
        {
          turnId: "turn-1",
          surfacePiSessionId: "surface-1",
          piToolCallId: "tool-call-1",
          toolName: "no_arg_tool",
          argumentsJson: "null",
          emit: executions[0] && (executions[0] as { emit: unknown }).emit,
        },
      ]);
      assert.strictEqual(typeof (executions[0] as { emit?: unknown }).emit, "function");
    }),
  );

  it.effect("forwards executor-emitted tool updates through the supplied sink", () =>
    Effect.gen(function* () {
      const emitSinkInvocations: unknown[] = [];
      const emittedEffects: Effect.Effect<void, unknown>[] = [];
      const update: PiToolExecutionUpdate = {
        type: "progress",
        commandId: "command_test" as never,
        message: "Halfway",
        occurredAt: "2026-07-01T12:00:00.000Z" as never,
      };
      const [tool] = createPiCustomToolDefinitions(
        [declaration],
        (input) => {
          emittedEffects.push(input.emit(update));
          return Effect.succeed({ content: [{ type: "text", text: "done" }], details: {} });
        },
        async () => ({ content: [{ type: "text", text: "done" }], details: {} }),
        (emitted) => {
          emitSinkInvocations.push(emitted);
          return Effect.void;
        },
        () => ({
          turnId: "turn_test" as TurnId,
          surfacePiSessionId: "surface_test" as SurfacePiSessionId,
        }),
      );

      const result = yield* Effect.promise(() =>
        tool!.execute("tool-call-test", {}, undefined, undefined, {} as never),
      );

      assert.strictEqual(emittedEffects.length, 1);
      assert.deepStrictEqual(emitSinkInvocations, [
        {
          turnId: "turn_test",
          surfacePiSessionId: "surface_test",
          piToolCallId: "tool-call-test",
          toolName: "example_tool",
          update,
        },
      ]);
      assert.deepStrictEqual(result, { content: [{ type: "text", text: "done" }], details: {} });
    }),
  );
});
