import { createHash } from "node:crypto";
import { Type } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import { z } from "zod";
import type { BundledWorkflowDefinition } from "./registry";

export const SMITHERS_RUN_WORKFLOW_TOOL_NAME = "smithers.run_workflow";
export const RESUME_RUN_ID_FIELD = "resumeRunId";

export type BundledWorkflowLaunchContract = {
  workflowId: string;
  workflowName: string;
  label: string;
  description: string;
  semanticToolName: typeof SMITHERS_RUN_WORKFLOW_TOOL_NAME;
  launchToolName: `smithers.run_workflow.${string}`;
  launchSchema: z.ZodTypeAny;
  launchInputJsonSchema: Record<string, unknown>;
  launchToolJsonSchema: Record<string, unknown>;
  launchToolParameters: TSchema;
  contractHash: string;
};

type JsonObject = Record<string, unknown>;

const WORKFLOW_ID_PATTERN = /^[a-z0-9_]+$/;

export function compileBundledWorkflowLaunchContract(
  definition: BundledWorkflowDefinition,
): BundledWorkflowLaunchContract {
  assertValidWorkflowId(definition.id);
  const launchInputJsonSchema = sanitizeToolJsonSchema(
    z.toJSONSchema(definition.launchSchema as any, { io: "input" }) as JsonObject,
  );
  ensureRootObjectSchema(launchInputJsonSchema, definition.id);

  const launchToolName = `${SMITHERS_RUN_WORKFLOW_TOOL_NAME}.${definition.id}` as const;
  const properties = {
    ...readObjectProperties(launchInputJsonSchema, definition.id),
  };
  if (RESUME_RUN_ID_FIELD in properties) {
    throw new Error(
      `Bundled Smithers workflow ${definition.id} uses reserved launch field ${RESUME_RUN_ID_FIELD}.`,
    );
  }

  properties[RESUME_RUN_ID_FIELD] = {
    type: "string",
    minLength: 1,
    description:
      "Resume the same Smithers run id when Smithers still considers that run resumable.",
  };

  const launchToolJsonSchema = sanitizeToolJsonSchema({
    type: "object",
    description: definition.description,
    properties,
    required: readRequiredProperties(launchInputJsonSchema),
    additionalProperties: launchInputJsonSchema.additionalProperties ?? false,
  });

  const contractHash = createStableHash({
    workflowId: definition.id,
    workflowName: definition.workflowName,
    label: definition.label,
    description: definition.description,
    semanticToolName: SMITHERS_RUN_WORKFLOW_TOOL_NAME,
    launchToolName,
    launchInputJsonSchema,
    launchToolJsonSchema,
  });

  return {
    workflowId: definition.id,
    workflowName: definition.workflowName,
    label: definition.label,
    description: definition.description,
    semanticToolName: SMITHERS_RUN_WORKFLOW_TOOL_NAME,
    launchToolName,
    launchSchema: definition.launchSchema,
    launchInputJsonSchema,
    launchToolJsonSchema,
    launchToolParameters: Type.Unsafe(launchToolJsonSchema) as TSchema,
    contractHash,
  };
}

export function createWorkflowToolSurfaceVersion(
  contracts: readonly BundledWorkflowLaunchContract[],
): string {
  return createStableHash(
    contracts.map((contract) => ({
      workflowId: contract.workflowId,
      contractHash: contract.contractHash,
    })),
  );
}

function assertValidWorkflowId(workflowId: string): void {
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new Error(
      `Bundled Smithers workflow id ${workflowId} must match ${WORKFLOW_ID_PATTERN.source} so svvy can generate a stable smithers.run_workflow.<workflow_id> tool name.`,
    );
  }
}

function ensureRootObjectSchema(schema: JsonObject, workflowId: string): void {
  if (schema.type !== "object") {
    throw new Error(
      `Bundled Smithers workflow ${workflowId} must expose an object launch schema so svvy can generate a workflow launch tool.`,
    );
  }
}

function readObjectProperties(schema: JsonObject, workflowId: string): JsonObject {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    if (schema.additionalProperties === true) {
      return {};
    }
    throw new Error(
      `Bundled Smithers workflow ${workflowId} must expose object launch properties or explicit additionalProperties: true.`,
    );
  }
  return properties as JsonObject;
}

function readRequiredProperties(schema: JsonObject): string[] {
  return Array.isArray(schema.required)
    ? schema.required.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function sanitizeToolJsonSchema(input: JsonObject): JsonObject {
  const clone = structuredClone(input);
  sanitizeJsonSchemaNode(clone);
  return clone;
}

function sanitizeJsonSchemaNode(node: unknown): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      sanitizeJsonSchemaNode(entry);
    }
    return;
  }

  const objectNode = node as JsonObject;
  delete objectNode.$schema;

  if (
    ("properties" in objectNode || "required" in objectNode) &&
    typeof objectNode.type !== "string"
  ) {
    objectNode.type = "object";
  }

  if (
    typeof objectNode.additionalProperties === "object" &&
    objectNode.additionalProperties !== null &&
    !Array.isArray(objectNode.additionalProperties) &&
    Object.keys(objectNode.additionalProperties as JsonObject).length === 0
  ) {
    objectNode.additionalProperties = true;
  }

  for (const value of Object.values(objectNode)) {
    sanitizeJsonSchemaNode(value);
  }
}

function createStableHash(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonObject).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
