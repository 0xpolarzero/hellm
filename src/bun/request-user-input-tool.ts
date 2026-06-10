import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "typebox";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { RequestUserInputSettings } from "../shared/agent-settings";
import type {
  StructuredCommandRecord,
  StructuredRequestUserInputAnswer,
  StructuredRequestUserInputRequestRecord,
  StructuredSessionStateStore,
} from "./structured-session-state";

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

export type RequestUserInputParams = Static<typeof requestUserInputParamsSchema>;

export type RequestUserInputResult = {
  answers: Array<{
    title: string;
    question: string;
    answer:
      | {
          kind: "option";
          label: string;
          text: string;
        }
      | {
          kind: "custom";
          text: string;
        };
    answeredBy: "default" | "user" | "timeout_default";
  }>;
};

const DEFAULT_REQUEST_USER_INPUT_SETTINGS: RequestUserInputSettings = {
  mode: "nonblocking",
  blockingTimeout: {
    enabled: true,
    durationMs: 300_000,
  },
};

type PendingBlockingRequest = {
  commandId: string;
  sessionId: string;
  timeout: ReturnType<typeof setTimeout> | null;
  resolve: ((result: RequestUserInputResult) => void) | null;
  reject: ((error: Error) => void) | null;
};

export class RequestUserInputRuntime {
  private settings: RequestUserInputSettings = structuredClone(DEFAULT_REQUEST_USER_INPUT_SETTINGS);
  private readonly pending = new Map<string, PendingBlockingRequest>();
  private onRequestUpdated: (() => void | Promise<void>) | null = null;

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

  setRequestUpdatedListener(listener: (() => void | Promise<void>) | null): void {
    this.onRequestUpdated = listener;
  }

  restoreOpenBlockingRequests(store: StructuredSessionStateStore): void {
    for (const snapshot of store.listSessionStates()) {
      for (const request of snapshot.requestUserInputRequests) {
        if (
          request.variant !== "blocking" ||
          request.status !== "open" ||
          this.pending.has(request.requestId)
        ) {
          continue;
        }
        this.pending.set(request.requestId, {
          commandId: request.commandId,
          sessionId: request.sessionId,
          timeout: null,
          resolve: null,
          reject: null,
        });
        this.enterBlockingWait(store, request);
        this.scheduleBlockingTimeout(store, request.requestId);
      }
    }
  }

  dispose(): void {
    for (const pending of this.pending.values()) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
    }
    this.pending.clear();
  }

  waitForBlockingRequest(input: {
    store: StructuredSessionStateStore;
    request: StructuredRequestUserInputRequestRecord;
    command: StructuredCommandRecord;
  }): Promise<RequestUserInputResult> {
    const existing = this.pending.get(input.request.requestId);
    if (existing) {
      return Promise.reject(
        new Error(`Blocking request_user_input is already waiting: ${input.request.requestId}`),
      );
    }

    this.enterBlockingWait(input.store, input.request);

    return new Promise<RequestUserInputResult>((resolve, reject) => {
      this.pending.set(input.request.requestId, {
        commandId: input.command.id,
        sessionId: input.request.sessionId,
        timeout: null,
        resolve,
        reject,
      });
      this.scheduleBlockingTimeout(input.store, input.request.requestId);
    });
  }

  setBlockingTimerPaused(
    store: StructuredSessionStateStore,
    requestId: string,
    paused: boolean,
  ): StructuredRequestUserInputRequestRecord {
    const request = store.setRequestUserInputTimerPaused({ requestId, paused });
    this.scheduleBlockingTimeout(store, requestId);
    return request;
  }

  resolveBlockingRequest(
    store: StructuredSessionStateStore,
    requestId: string,
  ): RequestUserInputResult | null {
    const request = store.getRequestUserInputRequest(requestId);
    if (request.questions.some((question) => question.status === "open")) {
      return null;
    }
    const pending = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (pending?.timeout) {
      clearTimeout(pending.timeout);
    }
    store.clearSessionWait({ sessionId: pending?.sessionId ?? request.sessionId });
    const result = buildResultFromRequest(request);
    const answeredBy = summarizeRequestUserInputResult(result);
    store.finishCommand({
      commandId: pending?.commandId ?? request.commandId,
      status: "succeeded",
      summary:
        request.questions.length === 1
          ? `Answered ${request.questions[0]!.title}.`
          : `Answered ${request.questions.length} clarification questions.`,
      facts: {
        questionCount: request.questions.length,
        answeredBy,
        result,
      },
    });
    pending?.resolve?.(result);
    return result;
  }

  rejectBlockingRequest(store: StructuredSessionStateStore, requestId: string, error: Error): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(requestId);
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    store.clearSessionWait({ sessionId: pending.sessionId });
    store.finishCommand({
      commandId: pending.commandId,
      status: "failed",
      error: error.message,
      summary: "Request user input failed.",
    });
    pending.reject?.(error);
  }

  cancelBlockingRequestsForSurface(
    store: StructuredSessionStateStore,
    surfacePiSessionId: string,
    reason = "Request user input cancelled.",
  ): void {
    for (const snapshot of store.listSessionStates()) {
      for (const request of snapshot.requestUserInputRequests) {
        if (
          request.surfacePiSessionId !== surfacePiSessionId ||
          request.variant !== "blocking" ||
          request.status !== "open"
        ) {
          continue;
        }
        const pending = this.pending.get(request.requestId);
        this.pending.delete(request.requestId);
        if (pending?.timeout) {
          clearTimeout(pending.timeout);
        }
        store.cancelRequestUserInputRequest({ requestId: request.requestId });
        store.clearSessionWait({ sessionId: request.sessionId });
        store.finishCommand({
          commandId: request.commandId,
          status: "cancelled",
          error: reason,
          summary: "Request user input cancelled.",
        });
        pending?.reject?.(new Error(reason));
      }
    }
  }

  private enterBlockingWait(
    store: StructuredSessionStateStore,
    request: StructuredRequestUserInputRequestRecord,
  ): void {
    store.finishCommand({
      commandId: request.commandId,
      status: "waiting",
      summary: `Waiting for user answer: ${request.questions.map((question) => question.title).join("; ")}`,
      facts: {
        questionCount: request.questions.length,
        answeredBy: "pending",
      },
    });
    this.ensureBlockingWaitProjection(store, request);
  }

  private ensureBlockingWaitProjection(
    store: StructuredSessionStateStore,
    request: StructuredRequestUserInputRequestRecord,
  ): void {
    try {
      store.setSessionWait({
        sessionId: request.sessionId,
        owner: request.threadId
          ? { kind: "thread", threadId: request.threadId }
          : { kind: "orchestrator" },
        kind: "user",
        reason:
          request.questions.length === 1
            ? request.questions[0]!.title
            : `Waiting for ${request.questions.length} clarification answers.`,
        resumeWhen: "Resume when the user answers the clarification request.",
      });
    } catch {
      // The command-level wait still preserves the surface prompt lock. Whole-session
      // frontier waits are not valid while unrelated runnable thread work remains.
    }
  }

  private scheduleBlockingTimeout(store: StructuredSessionStateStore, requestId: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      return;
    }
    if (pending.timeout) {
      clearTimeout(pending.timeout);
      pending.timeout = null;
    }

    const request = store.getRequestUserInputRequest(requestId);
    const timeout = request.timeout;
    if (
      request.status !== "open" ||
      timeout?.enabled !== true ||
      timeout.pausedAt ||
      !timeout.expiresAt
    ) {
      return;
    }
    const durationMs = Math.max(0, Date.parse(timeout.expiresAt) - Date.now());
    pending.timeout = setTimeout(() => {
      try {
        const expired = store.defaultOpenRequestUserInputQuestions({
          requestId,
          answeredBy: "timeout_default",
        });
        this.resolveBlockingRequest(store, expired.requestId);
        void Promise.resolve(this.onRequestUpdated?.()).catch((error) => {
          console.error("Failed to publish request_user_input timeout update:", error);
        });
      } catch (error) {
        this.rejectBlockingRequest(
          store,
          requestId,
          error instanceof Error ? error : new Error("Blocking request_user_input failed."),
        );
      }
    }, durationMs);
  }
}

function summarizeRequestUserInputResult(
  result: RequestUserInputResult,
): "user" | "default" | "timeout_default" | "mixed" {
  const values = new Set(result.answers.map((answer) => answer.answeredBy));
  if (values.size === 1) {
    return result.answers[0]?.answeredBy ?? "default";
  }
  return "mixed";
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

function readQuestionTitle(question: unknown): string | null {
  if (!question || typeof question !== "object" || Array.isArray(question)) {
    return null;
  }
  const title = (question as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

export function createRequestUserInputTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  store: StructuredSessionStateStore;
  requestUserInputRuntime?: RequestUserInputRuntime;
}): AgentTool<typeof requestUserInputParamsSchema, RequestUserInputResult> {
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

      options.store.setTurnDecision({
        turnId: runtime.turnId,
        decision: REQUEST_USER_INPUT_TOOL_NAME,
        onlyIfPending: true,
      });
      const command = options.store.createCommand({
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
      });
      options.store.startCommand(command.id);
      let questions: ReturnType<typeof validateRequestUserInputParams>;
      try {
        questions = validateRequestUserInputParams(params);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid request_user_input parameters.";
        options.store.finishCommand({
          commandId: command.id,
          status: "failed",
          summary: message,
          facts: null,
          error: message,
        });
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
      const request = options.store.createRequestUserInputRequest({
        sessionId: runtime.sessionId,
        surfacePiSessionId: runtime.surfacePiSessionId,
        threadId: runtime.surfaceKind === "handler" ? runtime.rootThreadId : null,
        turnId: runtime.turnId,
        commandId: command.id,
        toolItemId: _toolCallId,
        variant: settings.mode,
        timeout:
          settings.mode === "blocking"
            ? {
                enabled: settings.blockingTimeout.enabled,
                durationMs: settings.blockingTimeout.durationMs,
              }
            : null,
        questions: defaultQuestions,
      });
      recordRequestUserInputProgress(options.store, {
        sessionId: runtime.sessionId,
        commandId: command.id,
        requestId: request.requestId,
        variant: settings.mode,
        questionCount: defaultQuestions.length,
      });

      if (settings.mode === "blocking") {
        const blockingResult = await requestUserInputRuntime.waitForBlockingRequest({
          store: options.store,
          request,
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

      options.store.finishCommand({
        commandId: command.id,
        status: "succeeded",
        summary:
          questions.length === 1
            ? `Defaulted answer for ${questions[0]!.title}.`
            : `Defaulted answers for ${questions.length} questions.`,
        facts: {
          questionCount: questions.length,
          answeredBy: "default",
          result,
        },
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
    },
  };
}

function recordRequestUserInputProgress(
  store: StructuredSessionStateStore,
  input: {
    sessionId: string;
    commandId: string;
    requestId: string;
    variant: RequestUserInputSettings["mode"];
    questionCount: number;
  },
): void {
  store.recordLifecycleEvent({
    sessionId: input.sessionId,
    kind: "command.progress",
    subjectKind: "command",
    subjectId: input.commandId,
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
  });
}

function buildResultFromRequest(
  request: StructuredRequestUserInputRequestRecord,
): RequestUserInputResult {
  return {
    answers: request.questions.map((question) => {
      const answer = request.answers
        .filter((entry) => entry.questionId === question.questionId)
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
        .at(-1);
      return {
        title: question.title,
        question: question.question,
        answer: structuredClone(answer?.answer ?? question.defaultAnswer),
        answeredBy: answer?.answeredBy ?? "default",
      };
    }),
  };
}

type ValidatedQuestion =
  | {
      title: string;
      question: string;
      options: Array<{ label: string; description: string; recommended?: true }>;
    }
  | {
      title: string;
      question: string;
      defaultAnswer: string;
    };

function validateRequestUserInputParams(input: RequestUserInputParams): ValidatedQuestion[] {
  assertExactKeys(input, ["questions"], "request_user_input input");
  if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 3) {
    throw new Error(`${REQUEST_USER_INPUT_TOOL_NAME} requires one to three questions.`);
  }

  return input.questions.map((rawQuestion, index) => {
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
      const options = rawQuestion.options ?? [];
      if (options.length < 2 || options.length > 3) {
        throw new Error(`Question ${questionNumber} requires two or three options.`);
      }
      const normalizedOptions = options.map((option, optionIndex) => {
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
        return {
          label,
          description,
          ...(option.recommended ? { recommended: true as const } : {}),
        };
      });
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
}

function defaultAnswerForQuestion(question: ValidatedQuestion): StructuredRequestUserInputAnswer {
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
