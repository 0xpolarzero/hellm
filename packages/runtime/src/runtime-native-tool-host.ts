import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  AbsolutePath,
  ActorBinding,
  CommandId,
  NativeToolResult,
  RuntimeContractError,
  RuntimeSurfaceTarget,
  ToolCallId,
  TurnId,
  WorkspaceId,
} from "@svvy/core";

export type RuntimeDirectNativeToolHostInput = {
  readonly workspaceId: WorkspaceId;
  readonly target: RuntimeSurfaceTarget;
  readonly turnId: TurnId;
  readonly toolCallId: ToolCallId;
  readonly commandId: CommandId;
  readonly toolName: "exec_command" | "write_stdin" | "apply_patch";
  readonly arguments: unknown;
  readonly actorBinding: ActorBinding;
  readonly approvalMode: "auto-review" | "user" | "full-access";
  readonly cwd: AbsolutePath;
  readonly signal?: AbortSignal;
};

export interface RuntimePrimitiveToolHostPortService {
  runDirectNativeTool(
    input: RuntimeDirectNativeToolHostInput,
  ): Effect.Effect<NativeToolResult, RuntimeContractError>;
}

export class RuntimePrimitiveToolHostPort extends Context.Service<
  RuntimePrimitiveToolHostPort,
  RuntimePrimitiveToolHostPortService
>()("@svvy/runtime/RuntimePrimitiveToolHostPort") {}
