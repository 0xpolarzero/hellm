import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static } from "@sinclair/typebox";

const listToolsParamsSchema = Type.Object(
  {
    toolName: Type.Optional(Type.String({ minLength: 1 })),
    includeSchemas: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

type ListToolsParams = Static<typeof listToolsParamsSchema>;

type ToolInfo = {
  name: string;
  description?: string;
  parameters?: unknown;
  sourceInfo?: unknown;
};

type ToolSession = {
  getActiveToolNames(): string[];
  getAllTools(): ToolInfo[];
};

type ListToolsResult = {
  activeToolNames: string[];
  tools: ToolInfo[];
};

export const LIST_TOOLS_TOOL_NAME = "list_tools";

export function createListToolsTool(options: {
  getSession: () => ToolSession | null;
}): AgentTool<typeof listToolsParamsSchema, ListToolsResult> {
  return {
    name: LIST_TOOLS_TOOL_NAME,
    label: "List Tools",
    description:
      "List the currently active tools available on this actor surface, with descriptions and optional parameter schemas.",
    parameters: listToolsParamsSchema,
    async execute(_toolCallId, params) {
      const session = options.getSession();
      if (!session) {
        throw new Error(`${LIST_TOOLS_TOOL_NAME} can only run after the pi session is ready.`);
      }

      const activeToolNames = session.getActiveToolNames();
      const active = new Set(activeToolNames);
      const requestedName = params.toolName?.trim();
      const tools = session
        .getAllTools()
        .filter((tool) => active.has(tool.name))
        .filter((tool) => !requestedName || tool.name === requestedName)
        .map((tool) => formatToolInfo(tool, params));

      return textToolResult(
        JSON.stringify(
          {
            activeToolNames,
            tools,
          },
          null,
          2,
        ),
        {
          activeToolNames,
          tools,
        },
      );
    },
  };
}

function formatToolInfo(tool: ToolInfo, params: ListToolsParams): ToolInfo {
  return {
    name: tool.name,
    description: tool.description,
    ...(params.includeSchemas ? { parameters: tool.parameters } : {}),
    ...(tool.sourceInfo ? { sourceInfo: tool.sourceInfo } : {}),
  };
}

function textToolResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}
