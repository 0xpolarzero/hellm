type NativeToolSchemaExtension = {
  id: string;
  title: string;
  description: string;
  category: string;
  interface: string;
};

type NativeToolSchema = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
};

const emptyParameters = {
  type: "object",
  additionalProperties: false,
  properties: {},
  required: [],
};

const nativeToolDefinitionsByExtensionId: Record<string, NativeToolSchema[]> = {
  shell: [
    {
      name: "exec_command",
      label: "exec_command",
      description:
        "Execute a shell command in the current workspace. Returns stdout and stderr. Use this for command-family work such as svvyx, git, gh, cx, smithers, tests, and builds.",
      parameters: objectParameters(
        {
          cmd: { type: "string", minLength: 1, description: "Shell command to execute." },
          workdir: {
            type: "string",
            minLength: 1,
            description: "Working directory for the command. Defaults to the workspace root.",
          },
          timeout: { type: "number", description: "Timeout in seconds." },
        },
        ["cmd"],
      ),
    },
    {
      name: "write_stdin",
      label: "write_stdin",
      description:
        "Write text to a running exec_command session. This is only valid for command sessions that returned a session_id.",
      parameters: objectParameters(
        {
          session_id: {
            type: "string",
            minLength: 1,
            description: "Running exec_command session id.",
          },
          input: { type: "string", description: "Text to write to the process stdin." },
        },
        ["session_id", "input"],
      ),
    },
  ],
  "apply-patch": [
    {
      name: "apply_patch",
      label: "apply_patch",
      description:
        "Apply a unified patch to files in the current workspace. Use this for targeted source edits.",
      parameters: objectParameters(
        {
          patch: { type: "string", minLength: 1, description: "Patch text to apply." },
        },
        ["patch"],
      ),
    },
  ],
  "execute-typescript": [
    {
      name: "execute_typescript",
      label: "Code Mode",
      description:
        "Run a bounded TypeScript program against actor-local generated extension clients. Use this only when TypeScript control flow is needed for batching, looping, filtering, aggregation, or transforming structured extension results.",
      parameters: objectParameters(
        {
          typescriptCode: { type: "string", minLength: 1 },
        },
        ["typescriptCode"],
      ),
    },
  ],
  "extension-loading": [
    {
      name: "list_extensions",
      label: "List Extensions",
      description:
        "List the current actor's loaded and available extensions without unavailable details, secrets, fingerprints, or global profile state.",
      parameters: emptyParameters,
    },
    {
      name: "load_extension",
      label: "Load Extension",
      description:
        "Load one available ready extension into this actor session and refresh actor-local extension visibility.",
      parameters: objectParameters(
        {
          extensionId: { type: "string", minLength: 1 },
        },
        ["extensionId"],
      ),
    },
  ],
  "request-user-input": [
    {
      name: "request_user_input",
      label: "Request User Input",
      description:
        "Ask one to three bounded user clarification questions. The active extension setting controls whether the call returns defaults immediately or blocks until user answer/timeout.",
      parameters: objectParameters(
        {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string", minLength: 1 },
                question: { type: "string", minLength: 1 },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 3,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      label: { type: "string", minLength: 1 },
                      description: { type: "string", minLength: 1 },
                      recommended: { type: "boolean" },
                    },
                    required: ["label", "description"],
                  },
                },
                defaultAnswer: { type: "string", minLength: 1 },
              },
              required: ["title", "question"],
            },
          },
        },
        ["questions"],
      ),
    },
  ],
  "thread-orchestration": [
    {
      name: "thread_start",
      label: "Thread",
      description:
        "Open a delegated handler thread for a bounded objective. Normally pass one threads[] item; pass multiple only for separate user-visible handler conversations.",
      parameters: objectParameters(
        {
          threadGroupId: { type: "string", minLength: 1 },
          threads: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                objective: { type: "string", minLength: 1 },
                history: { enum: ["isolated", "forked"] },
                overrides: {
                  type: "object",
                  additionalProperties: { enum: ["loaded", "available", "unavailable"] },
                },
              },
              required: ["objective"],
            },
          },
        },
        ["threads"],
      ),
    },
    threadListSchema(),
    threadEpisodesSchema(),
    threadFollowupSchema(),
    threadRequestReportSchema(),
  ],
  "thread-handling": [
    {
      name: "thread_current",
      label: "Thread Current",
      description:
        "Return the current handler thread identity, objective state, extension ids, report requests, and latest episode.",
      parameters: emptyParameters,
    },
    {
      name: "thread_group",
      label: "Thread Group",
      description:
        "Return the current handler thread group topology and sibling objective summaries.",
      parameters: emptyParameters,
    },
    threadEpisodesSchema(),
    {
      name: "thread_report",
      label: "Thread Report",
      description:
        "Emit a durable handler-thread update or conclusion episode. Use with outcome to conclude the current handler objective and notify the orchestrator.",
      parameters: objectParameters(
        {
          summary: { type: "string", minLength: 1 },
          details: { type: "string", minLength: 1 },
          outcome: { enum: ["succeeded", "failed", "cancelled"] },
          relatedArtifactIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
          relatedCommandIds: {
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
        ["summary"],
      ),
    },
  ],
};

export function buildNativeToolSchemasJson(records: readonly NativeToolSchemaExtension[]): string {
  return `${JSON.stringify(
    {
      nativeTools: records
        .filter((record) => record.interface === "native_tool")
        .map(nativeToolSchemaForExtension)
        .toSorted((left, right) => left.id.localeCompare(right.id)),
    },
    null,
    2,
  )}\n`;
}

export function buildNativeToolSchemaJsonForExtension(
  extension: NativeToolSchemaExtension,
): string {
  return `${JSON.stringify(nativeToolSchemaForExtension(extension), null, 2)}\n`;
}

function nativeToolSchemaForExtension(extension: NativeToolSchemaExtension) {
  const tools = nativeToolDefinitionsByExtensionId[extension.id];
  if (!tools) {
    throw new Error(`Missing native tool schema definitions for extension: ${extension.id}`);
  }
  return {
    id: extension.id,
    title: extension.title,
    description: extension.description,
    category: extension.category,
    tools,
  };
}

function objectParameters(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function threadListSchema(): NativeToolSchema {
  return {
    name: "thread_list",
    label: "Thread List",
    description:
      "List delegated handler threads that may need attention, with compact objective, status, wait, and latest episode metadata.",
    parameters: objectParameters(
      {
        status: {
          type: "array",
          items: {
            enum: [
              "running-handler",
              "running-workflow",
              "waiting",
              "idle",
              "troubleshooting",
              "completed",
            ],
          },
        },
        threadGroupId: { type: "string", minLength: 1 },
        limit: { type: "number", minimum: 1, maximum: 100 },
      },
      [],
    ),
  };
}

function threadEpisodesSchema(): NativeToolSchema {
  return {
    name: "thread_episodes",
    label: "Thread Episodes",
    description: "Read durable handler-thread episodes when exact episode content matters.",
    parameters: objectParameters(
      {
        threadId: { type: "string", minLength: 1 },
        threadGroupId: { type: "string", minLength: 1 },
        limit: { type: "number", minimum: 1, maximum: 50 },
      },
      [],
    ),
  };
}

function threadFollowupSchema(): NativeToolSchema {
  return {
    name: "thread_followup",
    label: "Thread Followup",
    description:
      "Queue corrections, clarifications, or later instructions to exact handler threads or one thread group.",
    parameters: objectParameters(
      {
        threadIds: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        threadGroupId: { type: "string", minLength: 1 },
        message: { type: "string", minLength: 1 },
        activate: { type: "boolean" },
      },
      ["message"],
    ),
  };
}

function threadRequestReportSchema(): NativeToolSchema {
  return {
    name: "thread_request_report",
    label: "Thread Request Report",
    description:
      "Ask one handler thread for an explicit thread_report update without changing its objective.",
    parameters: objectParameters(
      {
        threadId: { type: "string", minLength: 1 },
        request: { type: "string", minLength: 1 },
      },
      ["threadId"],
    ),
  };
}
