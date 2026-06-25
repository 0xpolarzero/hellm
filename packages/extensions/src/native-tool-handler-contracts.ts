import type * as Effect from "effect/Effect";
import type * as Redacted from "effect/Redacted";
import type {
  CommandId,
  ExtensionError,
  ExtensionHandlerResult,
  NativeToolDeclaration,
  NativeToolResult,
  NativeToolUpdateHandler,
  PromptExecutionContext,
  RuntimeSurfaceTarget,
  ToolCallId,
  TurnId,
} from "@svvy/core";
import type { ActorExtensionBinding } from "./extensions-service";

export type NativeToolDefinition<TParams = unknown, TResult = unknown> = NativeToolDeclaration & {
  execute: (
    toolCallId: string,
    params: TParams,
    signal?: AbortSignal,
    onUpdate?: NativeToolUpdateHandler<TResult>,
  ) => Promise<NativeToolResult<TResult>>;
};

export type ResolvedExtensionInvocationEnv = {
  extensionId: string;
  nonSecretValues: Readonly<Record<string, string>>;
  secretValues: Readonly<Record<string, Redacted.Redacted<string>>>;
  redactedKeys: readonly string[];
  secretRevisionFingerprint: string;
};

export type CommandInvocationContext = {
  commandId: CommandId;
  target: RuntimeSurfaceTarget;
  turnId: TurnId;
  approvalMode: "auto-review" | "user" | "full-access";
  approvalFacts?: Readonly<Record<string, unknown>>;
  sandbox: {
    snapshot: Readonly<Record<string, unknown>>;
    launchPolicy?: Readonly<Record<string, unknown>>;
  };
  cwd: string;
  baseEnv: Readonly<Record<string, string>>;
  extensionEnv?: ResolvedExtensionInvocationEnv;
};

export type ExtensionInvocation = {
  toolCallId: ToolCallId;
  toolName: string;
  arguments: AcceptedNativeToolArguments;
  context: PromptExecutionContext;
  actorBinding: ActorExtensionBinding;
  command: CommandInvocationContext;
};

export type AcceptedNativeToolArguments<TValue = unknown> = {
  schemaId: string;
  value: TValue;
};

export type ExtensionHandlerDeps = never;

export type ExtensionHandler<
  TInvocation = ExtensionInvocation,
  TRequirements = ExtensionHandlerDeps,
> = {
  invoke(input: TInvocation): Effect.Effect<ExtensionHandlerResult, ExtensionError, TRequirements>;
};
