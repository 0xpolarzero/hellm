import { type NativeToolDefinition } from "@svvy/extensions";
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import { Type } from "typebox";
import {
  decodeRequestUserInputInputExit,
  type RequestUserInputInput,
  type RequestUserInputResult,
} from "@svvy/extensions";
import type { RuntimeBlockingRequestInputEffectState } from "@svvy/runtime/bootstrap";
import {
  type CommandId,
  type PromptExecutionRuntimeHandle,
  type PromptTarget,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeTurnStatePortService,
  type RequestUserInputResolvedAnswer,
  type StateContractError,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";
import {
  createRuntimeBlockingRequestInputWaitRegistryHandle,
  runAcceptedRequestUserInputToolCallAtRuntimeBoundary,
  type RuntimeBlockingRequestInputWaitRegistryHandle,
} from "./runtime-service-adapter";
import type { RequestUserInputSettings } from "../shared/agent-settings";

export const REQUEST_USER_INPUT_TOOL_NAME = "request_user_input";

const requestUserInputOptionSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    recommended: Type.Optional(Type.Literal(true)),
  },
  { additionalProperties: false },
);

const requestUserInputQuestionSchema = Type.Object(
  {
    title: Type.String({ minLength: 1 }),
    question: Type.String({ minLength: 1 }),
    options: Type.Optional(Type.Array(requestUserInputOptionSchema, { minItems: 2, maxItems: 3 })),
    defaultAnswer: Type.Optional(Type.String({ minLength: 1 })),
  },
  { additionalProperties: false },
);

function buildRequestUserInputParamsSchema(mode: RequestUserInputSettings["mode"]) {
  return Type.Object(
    {
      questions: Type.Array(requestUserInputQuestionSchema, {
        minItems: 1,
        maxItems: 3,
        description:
          mode === "blocking"
            ? "One to three clarification questions to ask before proceeding. Each question still needs a default because the timeout may fall back to it."
            : "One to three clarification questions. Each question needs a conservative default answer because this tool returns immediately.",
      }),
    },
    { additionalProperties: false },
  );
}

export const requestUserInputParamsSchema = buildRequestUserInputParamsSchema("nonblocking");

const REQUEST_USER_INPUT_TOOL_DESCRIPTIONS: Record<RequestUserInputSettings["mode"], string> = {
  nonblocking:
    "Ask one to three bounded user clarification questions. Returns recommended/default answers immediately; later user answers arrive as queued follow-up.",
  blocking:
    "Ask one to three bounded user clarification questions and wait until the user answers or the configured timeout supplies defaults.",
};

export function getRequestUserInputToolDescription(mode: RequestUserInputSettings["mode"]): string {
  return REQUEST_USER_INPUT_TOOL_DESCRIPTIONS[mode];
}

export type RequestUserInputParams = RequestUserInputInput;

const DEFAULT_REQUEST_USER_INPUT_SETTINGS: RequestUserInputSettings = {
  mode: "nonblocking",
  blockingTimeout: {
    enabled: true,
    durationMs: 300_000,
  },
};

export type RequestUserInputToolState = {
  commandState: RuntimeCommandStatePortService;
  requestState: RuntimeRequestStatePortService;
  sessionWaitState: RuntimeSessionWaitStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
};

export type RequestUserInputBlockingState = Pick<
  RequestUserInputToolState,
  "commandState" | "requestState" | "sessionWaitState"
>;

export class RequestUserInputRuntime {
  private settings: RequestUserInputSettings = structuredClone(DEFAULT_REQUEST_USER_INPUT_SETTINGS);
  private onRequestUpdated: (() => void | Promise<void>) | null = null;
  private readonly blocking: RuntimeBlockingRequestInputWaitRegistryHandle;

  constructor(blocking?: RuntimeBlockingRequestInputWaitRegistryHandle) {
    this.blocking =
      blocking ??
      createRuntimeBlockingRequestInputWaitRegistryHandle({
        onRequestUpdated: async () => {
          await this.onRequestUpdated?.();
        },
      });
  }

  getSettings(): RequestUserInputSettings {
    return structuredClone(this.settings);
  }

  setSettings(settings: Partial<RequestUserInputSettings>): RequestUserInputSettings {
    this.settings = {
      mode: settings.mode ?? this.settings.mode,
      blockingTimeout: {
        enabled: settings.blockingTimeout?.enabled ?? this.settings.blockingTimeout.enabled,
        durationMs:
          settings.blockingTimeout?.durationMs ?? this.settings.blockingTimeout.durationMs,
      },
    };
    return this.getSettings();
  }

  setRequestUpdatedListener(listener: (() => void) | null): void {
    this.onRequestUpdated = listener;
  }

  restoreOpenBlockingRequests(state: RequestUserInputBlockingState): Promise<void> {
    return this.blocking.restoreOpenBlockingRequests(state);
  }

  dispose(): Promise<void> {
    return this.blocking.close();
  }

  waitForBlockingRequest(input: {
    state: RuntimeBlockingRequestInputEffectState;
    request: Parameters<
      RuntimeBlockingRequestInputWaitRegistryHandle["waitForBlockingRequest"]
    >[0]["request"];
    command: RuntimeCommandRecord;
  }): Promise<RequestUserInputResult> {
    return this.blocking.waitForBlockingRequest(input);
  }

  setBlockingTimerPaused(state: RequestUserInputBlockingState, requestId: string, paused: boolean) {
    return this.blocking.setBlockingTimerPaused(state, requestId, paused);
  }

  rescheduleBlockingTimeout(
    state: RequestUserInputBlockingState,
    requestId: string,
  ): Promise<void> {
    return this.blocking.rescheduleBlockingTimeout(state, requestId);
  }

  resolveBlockingRequest(
    state: RequestUserInputBlockingState,
    requestId: string,
  ): Promise<RequestUserInputResult | null> {
    return this.blocking.resolveBlockingRequest(state, requestId);
  }

  rejectBlockingRequest(
    state: RequestUserInputBlockingState,
    requestId: string,
    error: Error,
  ): Promise<void> {
    return this.blocking.rejectBlockingRequest(state, requestId, error);
  }

  cancelBlockingRequestsForSurface(
    state: RequestUserInputBlockingState,
    surfacePiSessionId: string,
    reason = "Request user input cancelled.",
  ): Promise<void> {
    return this.blocking.cancelBlockingRequestsForSurface(state, surfacePiSessionId, reason);
  }
}

function buildRequestUserInputCommandTitle(paramsQuestions: unknown): string {
  if (!Array.isArray(paramsQuestions)) {
    return "Ask user";
  }
  if (paramsQuestions.length === 1) {
    const title = readQuestionTitle(paramsQuestions[0]);
    return title ? `Ask user: ${title}` : "Ask user";
  }
  return `Ask user ${paramsQuestions.length} questions`;
}

function buildRequestUserInputCommandSummary(paramsQuestions: unknown): string {
  if (!Array.isArray(paramsQuestions)) {
    return "Request user input.";
  }
  const titles = paramsQuestions.flatMap((question) => {
    const title = readQuestionTitle(question);
    return title ? [title] : [];
  });
  return titles.length > 0 ? titles.join("; ") : "Request user input.";
}

function buildDefaultedRequestUserInputSummary(
  paramsQuestions: readonly { title: string }[],
): string {
  return paramsQuestions.length === 1
    ? `Defaulted answer for ${paramsQuestions[0]!.title}.`
    : `Defaulted answers for ${paramsQuestions.length} questions.`;
}

function readQuestionTitle(question: unknown): string | null {
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    return null;
  }
  const title = (question as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

function promptTargetFromRuntime(
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>,
): PromptTarget {
  if (runtime.surfaceKind === "orchestrator") {
    return {
      workspaceSessionId: runtime.workspaceSessionId as PromptTarget["workspaceSessionId"],
      surface: "orchestrator",
      surfacePiSessionId: runtime.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
    };
  }
  if (runtime.surfaceKind === "handler") {
    const threadId = runtime.rootThreadId ?? runtime.threadId;
    if (!threadId) {
      throw new Error(`${REQUEST_USER_INPUT_TOOL_NAME} handler runtime requires a thread id.`);
    }
    return {
      workspaceSessionId: runtime.workspaceSessionId as PromptTarget["workspaceSessionId"],
      surface: "handler",
      surfacePiSessionId: runtime.surfacePiSessionId as PromptTarget["surfacePiSessionId"],
      threadId: threadId as Extract<PromptTarget, { surface: "handler" }>["threadId"],
    };
  }
  throw new Error(
    `${REQUEST_USER_INPUT_TOOL_NAME} can only run on orchestrator or handler surfaces.`,
  );
}

function describeRequestUserInputError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (error && typeof error === "object" && "issue" in error) {
    const issue = (error as { issue?: unknown }).issue;
    if (typeof issue === "string" && issue.trim()) {
      if (issue.includes("require exactly one recommended option")) {
        return "request_user_input requires exactly one recommended option for choice questions.";
      }
      if (issue.includes('["questions"][0]["id"]')) {
        return "request_user_input unsupported field id.";
      }
      if (
        issue.includes('["defaultAnswer"]') &&
        issue.includes('["options"]') &&
        issue.includes("Unexpected key")
      ) {
        return "request_user_input requires either options or defaultAnswer, but not both.";
      }
      if (issue.includes("Expected a value with a length between 1 and 3")) {
        return "request_user_input requires one to three questions.";
      }
      return issue;
    }
  }
  return fallback;
}

async function runNonblockingRequestUserInputHandler(input: {
  toolCallId: string;
  params: RequestUserInputParams;
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  command: RuntimeCommandRecord;
  commandState: RuntimeCommandStatePortService;
  requestState: RuntimeRequestStatePortService;
}): Promise<RequestUserInputResult> {
  const target = promptTargetFromRuntime(input.runtime);
  const executed = await runAcceptedRequestUserInputToolCallAtRuntimeBoundary({
    request: {
      toolCallId: input.toolCallId as ToolCallId,
      toolItemId: input.toolCallId as ToolItemId,
      arguments: input.params,
      context: input.runtime,
      actorBinding: {
        loadedExtensionIds: input.runtime.loadedExtensionIds,
        availableExtensionIds: input.runtime.availableExtensionIds,
      },
      command: {
        commandId: input.command.id as CommandId,
        target,
        turnId: input.runtime.turnId! as TurnId,
        approvalMode: "auto-review",
        sandbox: { snapshot: {} },
        cwd: "",
        baseEnv: {},
      },
    },
    commandStatePort: input.commandState,
    requestStatePort: input.requestState,
  });
  return executed.result;
}

export function createRequestUserInputTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: RequestUserInputToolState;
  requestUserInputRuntime?: RequestUserInputRuntime;
}): NativeToolDefinition<RequestUserInputParams, RequestUserInputResult> {
  const requestUserInputRuntime = options.requestUserInputRuntime ?? new RequestUserInputRuntime();
  const initialSettings = requestUserInputRuntime.getSettings();
  return {
    label: "Request User Input",
    name: REQUEST_USER_INPUT_TOOL_NAME,
    description: getRequestUserInputToolDescription(initialSettings.mode),
    parameters: buildRequestUserInputParamsSchema(initialSettings.mode),
    execute: async (_toolCallId, params) => {
      const runtime = options.runtime.current;
      if (!runtime) {
        throw new Error(`${REQUEST_USER_INPUT_TOOL_NAME} can only run during an active prompt.`);
      }
      const settings = requestUserInputRuntime.getSettings();

      options.state.runState(
        options.state.turnState.setTurnDecision({
          turnId: runtime.turnId!,
          decision: REQUEST_USER_INPUT_TOOL_NAME,
          onlyIfPending: true,
        }),
      );
      const command = options.state.runState(
        options.state.commandState.createOrReuseStreamingCommand({
          toolCallId: _toolCallId,
          turnId: runtime.turnId,
          surfacePiSessionId: runtime.surfacePiSessionId,
          threadId: runtime.surfaceKind === "handler" ? runtime.rootThreadId : null,
          toolName: REQUEST_USER_INPUT_TOOL_NAME,
          executor: runtime.surfaceKind === "handler" ? "handler" : "orchestrator",
          visibility: "surface",
          title: buildRequestUserInputCommandTitle(params.questions),
          summary: buildRequestUserInputCommandSummary(params.questions),
          arguments: {
            questions: params.questions,
          },
          facts: {
            questionCount: Array.isArray(params.questions) ? params.questions.length : 0,
            answeredBy: "default",
          },
        }),
      ).value;
      options.state.runState(options.state.commandState.startCommand({ commandId: command.id }));
      if (settings.mode === "nonblocking") {
        try {
          const result = await runNonblockingRequestUserInputHandler({
            toolCallId: _toolCallId,
            params,
            runtime,
            command,
            commandState: options.state.commandState,
            requestState: options.state.requestState,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result),
              },
            ],
            details: result,
          };
        } catch (error) {
          const message = describeRequestUserInputError(
            error,
            "request_user_input handler failed.",
          );
          options.state.runState(
            options.state.commandState.finishCommand({
              commandId: command.id,
              status: "failed",
              summary: message,
              facts: null,
              error: message,
            }),
          );
          throw new Error(message, { cause: error });
        }
      }
      let questions: ReturnType<typeof validateRequestUserInputParams>;
      try {
        questions = validateRequestUserInputParams(params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid request_user_input parameters.";
        options.state.runState(
          options.state.commandState.finishCommand({
            commandId: command.id,
            status: "failed",
            summary: message,
            facts: null,
            error: message,
          }),
        );
        throw error;
      }
      const defaultQuestions = questions.map((question) => {
        const defaultAnswer = defaultAnswerForQuestion(question);
        return {
          title: question.title,
          question: question.question,
          defaultAnswer,
          ...("options" in question
            ? {
                choices: question.options.map((option) => ({
                  label: option.label,
                  description: option.description,
                  recommended: option.recommended === true,
                })),
              }
            : {}),
        };
      });
      const target = promptTargetFromRuntime(runtime);
      const request = options.state.runState(
        options.state.requestState.createRequestInput({
          target,
          turnId: runtime.turnId! as TurnId,
          sourceCommandId: command.id as CommandId,
          toolItemId: _toolCallId as ToolItemId,
          mode: settings.mode,
          timeout:
            settings.mode === "blocking"
              ? {
                  enabled: settings.blockingTimeout.enabled,
                  durationMs: settings.blockingTimeout.durationMs,
                }
              : null,
          questions: defaultQuestions,
        }),
      );
      const requestRecord = request.value;
      recordRequestUserInputProgress(options.state, {
        sessionId: runtime.workspaceSessionId,
        commandId: command.id,
        requestId: requestRecord.requestId,
        variant: settings.mode,
        questionCount: defaultQuestions.length,
      });
      const requestDetails = options.state.runState(
        options.state.requestState.getRequestInput({ requestId: requestRecord.requestId }),
      );

      if (settings.mode === "blocking") {
        const blockingResult = await requestUserInputRuntime.waitForBlockingRequest({
          state: options.state,
          request: requestDetails,
          command,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(blockingResult),
            },
          ],
          details: blockingResult,
        };
      }

      const result: RequestUserInputResult = {
        answers: defaultQuestions.map((question) => ({
          title: question.title,
          question: question.question,
          answer: question.defaultAnswer,
          answeredBy: "default",
        })),
      };

      options.state.runState(
        options.state.commandState.finishCommand({
          commandId: command.id,
          status: "succeeded",
          summary: buildDefaultedRequestUserInputSummary(questions),
          facts: {
            questionCount: questions.length,
            answeredBy: "default",
            result,
          },
        }),
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        details: result,
      };
    },
  };
}

function recordRequestUserInputProgress(
  state: Pick<RequestUserInputToolState, "commandState" | "runState">,
  input: {
    sessionId: string;
    commandId: string;
    requestId: string;
    variant: RequestUserInputSettings["mode"];
    questionCount: number;
  },
): void {
  state.runState(
    state.commandState.recordCommandEvent({
      sessionId: input.sessionId,
      commandId: input.commandId,
      kind: "command.progress",
      data: {
        source: REQUEST_USER_INPUT_TOOL_NAME,
        phase: "created",
        message:
          input.questionCount === 1
            ? "Created 1 user-input question."
            : `Created ${input.questionCount} user-input questions.`,
        facts: {
          requestId: input.requestId,
          variant: input.variant,
          questionCount: input.questionCount,
        },
      },
    }),
  );
}

type ValidatedQuestion = RequestUserInputInput["questions"][number];
type RawRequestUserInputOption = {
  label: string;
  description: string;
  recommended?: unknown;
};

function validateRequestUserInputParams(
  input: RequestUserInputParams,
): readonly ValidatedQuestion[] {
  assertExactKeys(input, ["questions"], "request_user_input input");
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 3) {
    throw new Error(`${REQUEST_USER_INPUT_TOOL_NAME} requires one to three questions.`);
  }

  const normalizedQuestions = input.questions.map((rawQuestion, index) => {
    assertExactKeys(
      rawQuestion as unknown as Record<string, unknown>,
      ["title", "question", "options", "defaultAnswer"],
      `Question ${index + 1}`,
    );
    const questionNumber = index + 1;
    const title = rawQuestion.title.trim();
    const question = rawQuestion.question.trim();
    if (!title) {
      throw new Error(`Question ${questionNumber} requires a non-empty title.`);
    }
    if (!question) {
      throw new Error(`Question ${questionNumber} requires a non-empty question.`);
    }

    const hasOptions = rawQuestion.options !== undefined;
    const hasDefaultAnswer = rawQuestion.defaultAnswer !== undefined;
    if (hasOptions === hasDefaultAnswer) {
      throw new Error(
        `Question ${questionNumber} requires either options or defaultAnswer, but not both.`,
      );
    }

    if (hasOptions) {
      const options = rawQuestion.options as readonly RawRequestUserInputOption[];
      if (options.length < 2 || options.length > 3) {
        throw new Error(`Question ${questionNumber} requires two or three options.`);
      }
      const normalizedOptions = options.map(
        (option: RawRequestUserInputOption, optionIndex: number) => {
          assertExactKeys(
            option as unknown as Record<string, unknown>,
            ["label", "description", "recommended"],
            `Question ${questionNumber} option ${optionIndex + 1}`,
          );
          const label = option.label.trim();
          const description = option.description.trim();
          if (!label) {
            throw new Error(
              `Question ${questionNumber} option ${optionIndex + 1} requires a non-empty label.`,
            );
          }
          if (!description) {
            throw new Error(
              `Question ${questionNumber} option ${optionIndex + 1} requires a non-empty description.`,
            );
          }
          const recommended = option.recommended;
          if (recommended !== undefined && recommended !== true) {
            throw new Error(
              `Question ${questionNumber} option ${optionIndex + 1} can only set recommended to true.`,
            );
          }
          return {
            label,
            description,
            ...(option.recommended ? { recommended: true as const } : {}),
          };
        },
      );
      const recommendedCount = normalizedOptions.filter((option) => option.recommended).length;
      if (recommendedCount !== 1) {
        throw new Error(`Question ${questionNumber} requires exactly one recommended option.`);
      }
      return {
        title,
        question,
        options: normalizedOptions,
      };
    }

    const defaultAnswer = rawQuestion.defaultAnswer?.trim() ?? "";
    if (!defaultAnswer) {
      throw new Error(`Question ${questionNumber} requires a non-empty defaultAnswer.`);
    }
    return {
      title,
      question,
      defaultAnswer,
    };
  });

  return Exit.match(decodeRequestUserInputInputExit({ questions: normalizedQuestions }), {
    onSuccess: (decoded) => decoded.questions,
    onFailure: (cause) => {
      throw Cause.squash(cause);
    },
  });
}

function defaultAnswerForQuestion(question: ValidatedQuestion): RequestUserInputResolvedAnswer {
  if ("options" in question) {
    const recommended = question.options.find((option) => option.recommended);
    return {
      kind: "option",
      label: recommended!.label,
      text: recommended!.label,
    };
  }
  return {
    kind: "custom",
    text: question.defaultAnswer,
  };
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new Error(`${label} includes unsupported field ${unexpected}.`);
  }
}
