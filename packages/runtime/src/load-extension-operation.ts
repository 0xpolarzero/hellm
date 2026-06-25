import * as Effect from "effect/Effect";
import {
  decodeCommandResultEnvelopeEffect,
  RuntimeCommandStatePort,
  RuntimeContractError,
  type CommandId,
  type CommandResultEnvelope,
  type NativeToolContent,
  type NativeToolResult,
  type PromptExecutionContext,
  type PromptTarget,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import {
  loadExtensionHandler,
  type LoadExtensionHandlerInvocation,
  type LoadExtensionInput,
} from "@svvy/extensions";
import {
  applyActorExtensionBindingUpdateRuntimeEffectRequest,
  type AppliedRuntimeEffectRequest,
  type RuntimeEffectRequestApplicationContext,
} from "./runtime-effect-requests";

export type RuntimeLoadExtensionCommandContext = {
  commandId: CommandId;
  target: PromptTarget;
  turnId: TurnId;
  approvalMode: "auto-review" | "user" | "full-access";
  approvalFacts?: Readonly<Record<string, unknown>>;
  sandbox: {
    snapshot: Readonly<Record<string, unknown>>;
    launchPolicy?: Readonly<Record<string, unknown>>;
  };
  cwd: string;
  baseEnv: Readonly<Record<string, string>>;
};

export type RunAcceptedLoadExtensionToolCallInput = {
  toolCallId: ToolCallId;
  toolItemId: ToolItemId;
  arguments: LoadExtensionInput;
  context: PromptExecutionContext;
  actorBinding: LoadExtensionHandlerInvocation["actorBinding"];
  command: RuntimeLoadExtensionCommandContext;
  sourceInvalidation: NonNullable<RuntimeEffectRequestApplicationContext["sourceInvalidation"]>;
};

export type RunAcceptedLoadExtensionToolCallResult = {
  toolResult: NativeToolResult<CommandResultEnvelope>;
  appliedEffects: readonly AppliedRuntimeEffectRequest[];
};

function runtimeError(input: {
  reason: ConstructorParameters<typeof RuntimeContractError>[0]["reason"];
  message: string;
  issues?: RuntimeContractError["issues"];
  cause?: unknown;
}): RuntimeContractError {
  return new RuntimeContractError({
    operation: "runtime.load-extension.run",
    reason: input.reason,
    message: input.message,
    ...(input.issues ? { issues: input.issues } : {}),
    ...(input.cause === undefined ? {} : { cause: input.cause }),
  });
}

function buildHandlerInvocation(
  input: RunAcceptedLoadExtensionToolCallInput,
): LoadExtensionHandlerInvocation {
  return {
    toolCallId: input.toolCallId,
    toolName: "load_extension",
    arguments: {
      schemaId: "load_extension.input",
      value: input.arguments,
    },
    context: input.context,
    actorBinding: input.actorBinding,
    command: input.command,
  };
}

function normalizeNativeToolContent(content: readonly unknown[]): NativeToolContent[] {
  return content.map((item) => {
    if (
      item &&
      typeof item === "object" &&
      "type" in item &&
      (item as { type?: unknown }).type === "text" &&
      "text" in item &&
      typeof (item as { text?: unknown }).text === "string"
    ) {
      const textItem = item as unknown as { text: string; textSignature?: string | undefined };
      return {
        type: "text",
        text: textItem.text,
        ...(textItem.textSignature === undefined ? {} : { textSignature: textItem.textSignature }),
      };
    }
    const imageItem = item as { data: string; mimeType: string };
    return {
      type: "image",
      data: imageItem.data,
      mimeType: imageItem.mimeType,
    };
  });
}

export const runAcceptedLoadExtensionToolCall = Effect.fn(
  "@svvy/runtime/load-extension.runAccepted",
)(function* (input: RunAcceptedLoadExtensionToolCallInput) {
  const handlerResult = yield* loadExtensionHandler.invoke(buildHandlerInvocation(input)).pipe(
    Effect.mapError((cause) =>
      runtimeError({
        reason: "invalid-input",
        message: cause.message,
        ...(cause.issues ? { issues: cause.issues } : {}),
        cause,
      }),
    ),
  );

  const appliedEffects: AppliedRuntimeEffectRequest[] = [];
  for (const operation of handlerResult.operations ?? []) {
    if (
      operation.kind !== "runtime_effect" ||
      operation.request.type !== "actor_extension_binding.update"
    ) {
      return yield* Effect.fail(
        runtimeError({
          reason: "invalid-input",
          message: "load_extension handler returned an unsupported runtime operation.",
        }),
      );
    }
    appliedEffects.push(
      yield* applyActorExtensionBindingUpdateRuntimeEffectRequest(
        {
          target: input.command.target,
          turnId: input.command.turnId,
          toolItemId: input.toolItemId,
          sourceInvalidation: input.sourceInvalidation,
        },
        operation.request,
      ),
    );
  }

  const actorBindingEffect = appliedEffects.find(
    (effect) => effect.type === "actor_extension_binding.update",
  );
  if (actorBindingEffect?.type !== "actor_extension_binding.update") {
    return yield* Effect.fail(
      runtimeError({
        reason: "invalid-input",
        message: "load_extension handler did not update actor extension binding.",
      }),
    );
  }

  const details = yield* decodeCommandResultEnvelopeEffect(handlerResult.result.details).pipe(
    Effect.mapError((cause) =>
      runtimeError({
        reason: "invalid-input",
        message: "load_extension handler returned invalid command details.",
        cause,
      }),
    ),
  );

  const commandState = yield* RuntimeCommandStatePort;
  yield* commandState
    .finishCommand({
      commandId: input.command.commandId,
      status: "succeeded",
      summary:
        details.summary ??
        `Loaded extension ${input.arguments.extensionId.trim()} for the current actor.`,
      facts: details.commandFacts ?? {
        type: "load_extension.finished",
        status: "succeeded",
        extensionId: input.arguments.extensionId.trim(),
        usage: "loaded",
      },
    })
    .pipe(
      Effect.mapError((cause) =>
        runtimeError({
          reason: "stale-state",
          message: "Failed to finish load_extension command.",
          cause,
        }),
      ),
    );

  return {
    toolResult: {
      content: normalizeNativeToolContent(handlerResult.result.content),
      details,
    },
    appliedEffects,
  } satisfies RunAcceptedLoadExtensionToolCallResult;
});
