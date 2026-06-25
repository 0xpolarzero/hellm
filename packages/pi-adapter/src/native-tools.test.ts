import { describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { NativeToolDeclaration, PiToolExecutor, SurfacePiSessionId, TurnId } from "@svvy/core";
import { createPiCustomToolDefinitions } from "./native-tools";

describe("createPiCustomToolDefinitions", () => {
  it("adapts svvy native tool declarations and one Effect executor to pi custom tool definitions", async () => {
    const executions: unknown[] = [];
    const hostRunnerInputs: unknown[] = [];
    const declaration: NativeToolDeclaration = {
      name: "example_tool",
      label: "Example Tool",
      description: "Runs an example native tool.",
      parameters: { type: "object" },
    };
    const executor: PiToolExecutor = (input) => {
      executions.push(input);
      return Effect.succeed({
        content: [{ type: "text", text: "done" }],
        details: { step: 2 },
      });
    };

    const [tool] = createPiCustomToolDefinitions(
      [declaration],
      executor,
      async (effect) => {
        hostRunnerInputs.push(effect);
        return {
          content: [{ type: "text", text: "done" }],
          details: { step: 2 },
        };
      },
      (input) => ({
        turnId: "turn-1" as TurnId,
        surfacePiSessionId: "surface-1" as SurfacePiSessionId,
        observedToolCallId: input.piToolCallId,
      }),
    );
    expect(tool).toMatchObject({
      name: "example_tool",
      label: "Example Tool",
      description: "Runs an example native tool.",
      parameters: { type: "object" },
    });
    expect(tool).not.toHaveProperty("prepareArguments");

    const result = await tool?.execute(
      "tool-call-1",
      { value: "input" },
      undefined,
      undefined,
      {} as ExtensionContext,
    );

    expect(executions).toEqual([
      {
        turnId: "turn-1",
        surfacePiSessionId: "surface-1",
        piToolCallId: "tool-call-1",
        toolName: "example_tool",
        argumentsJson: '{"value":"input"}',
      },
    ]);
    expect(hostRunnerInputs).toHaveLength(1);
    expect(result).toEqual({
      content: [{ type: "text", text: "done" }],
      details: { step: 2 },
    });
  });
});
