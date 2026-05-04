import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@mariozechner/pi-coding-agent";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "@mariozechner/pi-ai";
import type { Static, TSchema } from "@sinclair/typebox";
import { basename } from "node:path";
import type { PromptExecutionRuntimeHandle } from "./prompt-execution-context";
import type { WorkflowLibrary } from "./smithers-runtime/workflow-library";
import type {
  StructuredArtifactKind,
  StructuredSessionStateStore,
} from "./structured-session-state";

const artifactWriteTextSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    text: Type.String(),
  },
  { additionalProperties: false },
);

const artifactWriteJsonSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    value: Type.Any(),
    pretty: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

const artifactAttachFileSchema = Type.Object(
  {
    path: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const workflowListAssetsSchema = Type.Object(
  {
    kind: Type.Optional(
      Type.Union([Type.Literal("definition"), Type.Literal("prompt"), Type.Literal("component")]),
    ),
    pathPrefix: Type.Optional(Type.String()),
    scope: Type.Optional(
      Type.Union([Type.Literal("saved"), Type.Literal("artifact"), Type.Literal("both")]),
    ),
  },
  { additionalProperties: false },
);

const workflowListModelsSchema = Type.Object({}, { additionalProperties: false });

type WorkflowListAssetsInput = Static<typeof workflowListAssetsSchema>;

type DirectToolOptions = {
  cwd: string;
  runtime: PromptExecutionRuntimeHandle;
  store: {
    createArtifact:
      | StructuredSessionStateStore["createArtifact"]
      | ((input: {
          sessionId?: string | null;
          threadId?: string | null;
          workflowRunId?: string | null;
          workflowTaskAttemptId?: string | null;
          sourceCommandId?: string | null;
          kind: StructuredArtifactKind;
          name?: string;
          path?: string;
          content?: string;
        }) => { id: string; path?: string });
  };
  workflowLibrary?: WorkflowLibrary;
};

type DirectToolSet = {
  codingTools: AgentTool<any>[];
  artifactTools: AgentTool<any>[];
  workflowTools: AgentTool<any>[];
};

export function createSvvyDirectTools(options: DirectToolOptions): DirectToolSet {
  return {
    codingTools: [
      createReadTool(options.cwd),
      createGrepTool(options.cwd),
      createFindTool(options.cwd),
      createLsTool(options.cwd),
      wrapSavedWorkflowValidationTool(createEditTool(options.cwd), options),
      wrapSavedWorkflowValidationTool(createWriteTool(options.cwd), options),
      createBashTool(options.cwd),
    ],
    artifactTools: [
      createArtifactWriteTextTool(options),
      createArtifactWriteJsonTool(options),
      createArtifactAttachFileTool(options),
    ],
    workflowTools: [createWorkflowListAssetsTool(options), createWorkflowListModelsTool(options)],
  };
}

function createArtifactWriteTextTool(
  options: DirectToolOptions,
): AgentTool<typeof artifactWriteTextSchema> {
  return createArtifactTool({
    name: "artifact.write_text",
    label: "artifact.write_text",
    description:
      "Write a UTF-8 artifact for durable byproducts or evidence that should not be a normal repository file.",
    parameters: artifactWriteTextSchema,
    options,
    kind: "text",
    summarize: (input) => `Write artifact ${input.name}`,
    content: (input) => input.text,
  });
}

function createArtifactWriteJsonTool(
  options: DirectToolOptions,
): AgentTool<typeof artifactWriteJsonSchema> {
  return createArtifactTool({
    name: "artifact.write_json",
    label: "artifact.write_json",
    description:
      "Write a JSON artifact for durable structured byproducts or evidence that should not be a normal repository file.",
    parameters: artifactWriteJsonSchema,
    options,
    kind: "json",
    summarize: (input) => `Write JSON artifact ${input.name}`,
    content: (input) => JSON.stringify(input.value, null, input.pretty === false ? undefined : 2),
  });
}

function createArtifactAttachFileTool(
  options: DirectToolOptions,
): AgentTool<typeof artifactAttachFileSchema> {
  return {
    name: "artifact.attach_file",
    label: "artifact.attach_file",
    description:
      "Attach an existing workspace file as durable artifact evidence without treating it as a requested repository deliverable.",
    parameters: artifactAttachFileSchema,
    async execute(toolCallId, input) {
      const runtime = options.runtime.current;
      const artifact = options.store.createArtifact({
        sessionId: runtime?.sessionId ?? null,
        threadId: runtime?.surfaceThreadId ?? runtime?.rootThreadId ?? null,
        sourceCommandId: readStructuredCommandId(toolCallId),
        kind: "file",
        name: input.name?.trim() || basename(input.path),
        path: input.path,
      });
      return textToolResult(`Attached artifact ${artifact.path ?? input.path}.`, {
        artifactId: artifact.id,
        path: artifact.path,
      });
    },
  };
}

function createArtifactTool<
  TSchema extends typeof artifactWriteTextSchema | typeof artifactWriteJsonSchema,
>(input: {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  options: DirectToolOptions;
  kind: StructuredArtifactKind;
  summarize: (params: Static<TSchema>) => string;
  content: (params: Static<TSchema>) => string;
}): AgentTool<TSchema> {
  return {
    name: input.name,
    label: input.label,
    description: input.description,
    parameters: input.parameters,
    async execute(toolCallId, params) {
      const runtime = input.options.runtime.current;
      const content = input.content(params);
      const artifact = input.options.store.createArtifact({
        sessionId: runtime?.sessionId ?? null,
        threadId: runtime?.surfaceThreadId ?? runtime?.rootThreadId ?? null,
        sourceCommandId: readStructuredCommandId(toolCallId),
        kind: input.kind,
        name: params.name,
        content,
      });
      return textToolResult(input.summarize(params), {
        artifactId: artifact.id,
        path: artifact.path,
      });
    },
  };
}

function createWorkflowListAssetsTool(
  options: DirectToolOptions,
): AgentTool<typeof workflowListAssetsSchema> {
  return {
    name: "workflow.list_assets",
    label: "workflow.list_assets",
    description:
      "List reusable saved or artifact workflow source assets for handler-side workflow authoring.",
    parameters: workflowListAssetsSchema,
    async execute(_toolCallId, input) {
      const assets = options.workflowLibrary?.listAssets(input as WorkflowListAssetsInput) ?? [];
      return textToolResult(JSON.stringify(assets, null, 2), { assets });
    },
  };
}

function createWorkflowListModelsTool(
  options: DirectToolOptions,
): AgentTool<typeof workflowListModelsSchema> {
  return {
    name: "workflow.list_models",
    label: "workflow.list_models",
    description: "List provider/model options available for workflow task-agent authoring.",
    parameters: workflowListModelsSchema,
    async execute() {
      const models = options.workflowLibrary?.listModels() ?? [];
      return textToolResult(JSON.stringify(models, null, 2), { models });
    },
  };
}

function textToolResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details,
  };
}

function wrapSavedWorkflowValidationTool<TToolSchema extends TSchema>(
  tool: AgentTool<TToolSchema>,
  options: DirectToolOptions,
): AgentTool<TToolSchema> {
  return {
    ...tool,
    async execute(toolCallId, input, signal) {
      const result = await tool.execute(toolCallId, input, signal);
      const path = readInputPath(input);
      if (!path || !options.workflowLibrary) {
        return result;
      }
      const validation = await options.workflowLibrary.validateSavedWorkflowWrite(path);
      if (!validation) {
        return result;
      }
      const status = validation.ok ? "passed" : `reported ${validation.diagnostics.length} issue`;
      const suffix = validation.diagnostics.length === 1 || validation.ok ? "" : "s";
      return {
        ...result,
        content: [
          ...result.content,
          {
            type: "text",
            text: `Workflow validation ${status}${suffix} after writing ${validation.path}.`,
          },
        ],
        details: {
          ...(result.details && typeof result.details === "object" ? result.details : {}),
          workflowValidation: validation,
        },
      };
    },
  };
}

function readInputPath(input: unknown): string | null {
  if (!input || typeof input !== "object" || !("path" in input)) {
    return null;
  }
  const path = (input as { path?: unknown }).path;
  return typeof path === "string" ? path : null;
}

function readStructuredCommandId(toolCallId: string): string | null {
  return toolCallId.startsWith("command-") ? toolCallId : null;
}
