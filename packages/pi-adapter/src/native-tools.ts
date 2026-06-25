import type * as Effect from "effect/Effect";
import type {
  NativeToolDeclaration,
  NativeToolResult,
  PiToolExecutor,
  RuntimeToolExecutionError,
  SurfacePiSessionId,
  ToolCallId,
  TurnId,
} from "@svvy/core";
import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

export type RunPiToolEffect = (
  effect: Effect.Effect<NativeToolResult, RuntimeToolExecutionError>,
) => Promise<NativeToolResult>;

export function createPiCustomToolDefinitions(
  declarations: readonly NativeToolDeclaration[],
  executor: PiToolExecutor,
  runToolEffect: RunPiToolEffect,
  getExecutionContext: (input: {
    readonly piToolCallId: ToolCallId;
    readonly toolName: string;
  }) => {
    readonly turnId: TurnId;
    readonly surfacePiSessionId: SurfacePiSessionId;
  },
): ToolDefinition[] {
  return declarations.map((tool) => {
    const definition: ToolDefinition = {
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters as ToolDefinition["parameters"],
      execute: async (toolCallId, params) => {
        const piToolCallId = toolCallId as ToolCallId;
        const context = getExecutionContext({ piToolCallId, toolName: tool.name });
        const result = await runToolEffect(
          executor({
            turnId: context.turnId,
            surfacePiSessionId: context.surfacePiSessionId,
            piToolCallId,
            toolName: tool.name,
            argumentsJson: JSON.stringify(params ?? null),
          }),
        );
        return result as Awaited<ReturnType<ToolDefinition["execute"]>>;
      },
    };
    return definition;
  });
}
