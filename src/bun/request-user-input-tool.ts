import { type NativeToolDefinition } from "@svvy/extensions";
import { Type } from "typebox";
import {
  type RequestUserInputInput,
  type RequestUserInputResult,
  type ActorExtensionBinding,
} from "@svvy/extensions";
import { nativeToolParameters } from "./native-tool-parameters";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import {
  type CommandFactsPayload,
  type CommandId,
  type NativeToolResult,
  type PositiveDurationMs,
  type PromptExecutionContext,
  type PromptTarget,
  type RuntimeCommandRecord,
  type RuntimeCommandStatePortService,
  type RuntimeRequestStatePortService,
  type RuntimeSessionWaitStatePortService,
  type RuntimeTurnStatePortService,
  type StateContractError,
  type ToolCallId,
  type ToolItemId,
  type TurnId,
} from "@svvy/core";
import type * as Effect from "effect/Effect";
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
    durationMs: 300_000 as PositiveDurationMs,
  },
};

export type RequestUserInputToolState = {
  commandState: RuntimeCommandStatePortService;
  requestState: RuntimeRequestStatePortService;
  sessionWaitState: RuntimeSessionWaitStatePortService;
  turnState: RuntimeTurnStatePortService;
  runState: <A>(effect: Effect.Effect<A, StateContractError>) => A;
};

type RequestUserInputEffectRunner = <A, E>(effect: Effect.Effect<A, E>) => Promise<A>;

export type RunAcceptedRequestUserInputInput = {
  toolCallId: ToolCallId;
  toolItemId: ToolItemId;
  arguments: RequestUserInputInput;
  context: PromptExecutionContext;
  actorBinding: ActorExtensionBinding;
  command: {
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
  commandRecord: RuntimeCommandRecord;
  requestInput: {
    mode: "nonblocking" | "blocking";
    blockingTimeout: {
      enabled: boolean;
      durationMs: PositiveDurationMs;
    };
  };
};

export type RunAcceptedRequestUserInputResult = {
  toolResult: NativeToolResult;
  result: RequestUserInputResult;
};

export type RunAcceptedRequestUserInput = (
  input: RunAcceptedRequestUserInputInput,
) => Promise<RunAcceptedRequestUserInputResult>;

export class RequestUserInputRuntime {
  private settings: RequestUserInputSettings = structuredClone(DEFAULT_REQUEST_USER_INPUT_SETTINGS);

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

async function runAcceptedRequestUserInputHandler(input: {
  toolCallId: string;
  params: RequestUserInputParams;
  runtime: NonNullable<PromptExecutionRuntimeHandle["current"]>;
  command: RuntimeCommandRecord;
  settings: RequestUserInputSettings;
  runAcceptedRequestUserInput: RunAcceptedRequestUserInput;
}): Promise<RequestUserInputResult> {
  const target = promptTargetFromRuntime(input.runtime);
  const executed = await input.runAcceptedRequestUserInput({
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
    commandRecord: input.command,
    requestInput: {
      mode: input.settings.mode,
      blockingTimeout: {
        enabled: input.settings.blockingTimeout.enabled,
        durationMs: input.settings.blockingTimeout.durationMs as PositiveDurationMs,
      },
    },
  });
  return executed.result;
}

export function createRequestUserInputTool(options: {
  runtime: PromptExecutionRuntimeHandle;
  state: RequestUserInputToolState;
  runToolEffect: RequestUserInputEffectRunner;
  runAcceptedRequestUserInput?: RunAcceptedRequestUserInput;
  requestUserInputRuntime?: RequestUserInputRuntime;
}): NativeToolDefinition<RequestUserInputParams> {
  const requestUserInputRuntime = options.requestUserInputRuntime ?? new RequestUserInputRuntime();
  const initialSettings = requestUserInputRuntime.getSettings();
  return {
    label: "Request User Input",
    name: REQUEST_USER_INPUT_TOOL_NAME,
    description: getRequestUserInputToolDescription(initialSettings.mode),
    parameters: nativeToolParameters(buildRequestUserInputParamsSchema(initialSettings.mode)),
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
      try {
        const result = await runAcceptedRequestUserInputHandler({
          toolCallId: _toolCallId,
          params,
          runtime,
          command,
          settings,
          runAcceptedRequestUserInput:
            options.runAcceptedRequestUserInput ?? missingAcceptedRequestUserInputRunner,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
          details: { commandFacts: result as CommandFactsPayload },
        };
      } catch (error) {
        const message = describeRequestUserInputError(error, "request_user_input handler failed.");
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
    },
  };
}

async function missingAcceptedRequestUserInputRunner(): Promise<RunAcceptedRequestUserInputResult> {
  throw new Error("request_user_input requires a runtime accepted-tool runner.");
}
