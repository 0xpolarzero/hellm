import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  ActorBinding,
  CancelCommandInput,
  CancelCommandResult,
  CommandId,
  NativeToolResult,
  PromptExecutionContext,
  RuntimeContractError,
  RuntimeSurfaceTarget,
  ToolCallId,
  TurnId,
  WriteCommandStdinInput,
  WriteCommandStdinResult,
  WorkspaceId,
} from "@svvy/core";

type RuntimeExecuteTypescriptCommandHostInput = {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly turnId: TurnId;
  readonly toolCallId: ToolCallId;
  readonly commandId: CommandId;
  readonly typescriptCode: string;
  readonly promptContext: PromptExecutionContext;
  readonly actorBinding: ActorBinding;
};

export interface RuntimeLayerCommandStdinPortService {
  writeStdin(
    input: WriteCommandStdinInput,
  ): Effect.Effect<WriteCommandStdinResult, RuntimeContractError>;
}

export interface RuntimeLayerCommandStdinPort {
  readonly _tag: "RuntimeLayerCommandStdinPort";
}

export const RuntimeLayerCommandStdinPort = Context.Service<
  RuntimeLayerCommandStdinPort,
  RuntimeLayerCommandStdinPortService
>("@svvy/runtime/RuntimeLayerCommandStdinPort");

export interface RuntimeLayerCommandControlPortService {
  cancel(input: CancelCommandInput): Effect.Effect<CancelCommandResult, RuntimeContractError>;
  runExecuteTypescript(
    input: RuntimeExecuteTypescriptCommandHostInput,
  ): Effect.Effect<NativeToolResult, RuntimeContractError>;
}

export interface RuntimeLayerCommandControlPort {
  readonly _tag: "RuntimeLayerCommandControlPort";
}

export const RuntimeLayerCommandControlPort = Context.Service<
  RuntimeLayerCommandControlPort,
  RuntimeLayerCommandControlPortService
>("@svvy/runtime/RuntimeLayerCommandControlPort");
