import * as Effect from "effect/Effect";
import {
  ExtensionError as CoreExtensionError,
  type ExtensionHandlerResult,
  type PromptTarget,
  type RequestInputChoiceQuestionRequest,
  type RequestInputFreeformQuestionRequest,
} from "@svvy/core";
import {
  decodeRequestUserInputInputEffect,
  type RequestUserInputInput,
  type RequestUserInputResult,
} from "./request-user-input-contracts";
import type { ExtensionHandler, ExtensionInvocation } from "./native-tool-handler-contracts";

export type RequestUserInputHandlerInvocation = ExtensionInvocation & {
  arguments: {
    schemaId: "request_user_input.input";
    value: RequestUserInputInput;
  };
};

function promptTargetFromInvocation(input: RequestUserInputHandlerInvocation): PromptTarget {
  const context = input.context;
  if (context.surfaceKind === "orchestrator") {
    return {
      workspaceSessionId: context.workspaceSessionId as PromptTarget["workspaceSessionId"],
      surface: "orchestrator",
      surfacePiSessionId: context.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
    };
  }
  if (context.surfaceKind === "handler") {
    const threadId = context.rootThreadId ?? context.threadId;
    if (!threadId) {
      throw new Error("request_user_input handler invocations require a handler thread id.");
    }
    return {
      workspaceSessionId: context.workspaceSessionId as PromptTarget["workspaceSessionId"],
      surface: "handler",
      surfacePiSessionId: context.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
      threadId: threadId as Extract<PromptTarget, { surface: "handler" }>["threadId"],
    };
  }
  throw new Error("request_user_input is only available on orchestrator and handler surfaces.");
}

function trimChoiceQuestion(
  question: RequestInputChoiceQuestionRequest,
): RequestInputChoiceQuestionRequest {
  return {
    title: question.title.trim(),
    question: question.question.trim(),
    options: question.options.map((option) => ({
      label: option.label.trim(),
      description: option.description.trim(),
      ...(option.recommended ? { recommended: true as const } : {}),
    })),
  };
}

function trimFreeformQuestion(
  question: RequestInputFreeformQuestionRequest,
): RequestInputFreeformQuestionRequest {
  return {
    title: question.title.trim(),
    question: question.question.trim(),
    defaultAnswer: question.defaultAnswer.trim(),
  };
}

function normalizeInput(input: unknown): Effect.Effect<RequestUserInputInput, unknown> {
  return Effect.gen(function* () {
    const decoded = yield* decodeRequestUserInputInputEffect(input);
    const questions = decoded.questions.map((question) =>
      "options" in question ? trimChoiceQuestion(question) : trimFreeformQuestion(question),
    );
    return yield* decodeRequestUserInputInputEffect({ questions });
  });
}

function defaultAnswerForQuestion(
  question: RequestUserInputInput["questions"][number],
): RequestUserInputResult["answers"][number]["answer"] {
  if ("options" in question) {
    const recommended = question.options.find((option) => option.recommended);
    if (!recommended) {
      throw new Error("request_user_input choice questions require one recommended option.");
    }
    return {
      kind: "option",
      label: recommended.label,
      text: recommended.label,
    };
  }
  return {
    kind: "custom",
    text: question.defaultAnswer,
  };
}

function buildDefaultResult(input: RequestUserInputInput): RequestUserInputResult {
  return {
    answers: input.questions.map((question) => ({
      title: question.title,
      question: question.question,
      answer: defaultAnswerForQuestion(question),
      answeredBy: "default",
    })),
  };
}

function resultSummary(input: RequestUserInputInput): string {
  return input.questions.length === 1
    ? `Defaulted answer for ${input.questions[0]!.title}.`
    : `Defaulted answers for ${input.questions.length} questions.`;
}

export function createRequestUserInputHandler(): ExtensionHandler<RequestUserInputHandlerInvocation> {
  return {
    invoke: (input) =>
      Effect.gen(function* () {
        const normalized = yield* normalizeInput(input.arguments.value);
        const target = yield* Effect.try({
          try: () => promptTargetFromInvocation(input),
          catch: (cause) => cause,
        });
        const result = buildDefaultResult(normalized);
        return {
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
            details: {
              status: "succeeded",
              summary: resultSummary(normalized),
              commandFacts: {
                questionCount: normalized.questions.length,
                answeredBy: "default",
                result,
              },
            },
          },
          operations: [
            {
              kind: "runtime_effect",
              request: {
                type: "request_input.create",
                input: {
                  target,
                  sourceCommandId: input.command.commandId,
                  questions: normalized.questions,
                },
              },
            },
          ],
        } satisfies ExtensionHandlerResult;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CoreExtensionError({
              extensionId: "request-user-input",
              operation: "extensions.native-tools.request-user-input.invoke",
              reason: "invalid-input",
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        ),
      ),
  };
}

export const requestUserInputHandler = createRequestUserInputHandler();
