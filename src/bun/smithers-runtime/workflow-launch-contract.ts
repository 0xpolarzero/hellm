import { z } from "zod";
import type { RunnableWorkflowRegistryEntry } from "./workflow-registry";

export const SMITHERS_RUN_WORKFLOW_TOOL_NAME = "smithers.run_workflow";

export type RunnableWorkflowLaunchContract = {
  workflowId: string;
  label: string;
  summary: string;
  sourceScope: RunnableWorkflowRegistryEntry["sourceScope"];
  entryPath: string;
  productKind?: RunnableWorkflowRegistryEntry["productKind"];
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
  assetPaths: string[];
  launchSchema: z.ZodTypeAny;
  launchInputJsonSchema: Record<string, unknown>;
  resultSchemaJsonSchema?: Record<string, unknown>;
};

type JsonObject = Record<string, unknown>;

const WORKFLOW_ID_PATTERN = /^[a-z0-9_]+$/;

export function compileRunnableWorkflowLaunchContract(
  entry: RunnableWorkflowRegistryEntry,
): RunnableWorkflowLaunchContract {
  assertValidWorkflowId(entry.workflowId);
  const launchInputJsonSchema = sanitizeToolJsonSchema(
    z.toJSONSchema(entry.launchSchema as any, { io: "input" }) as JsonObject,
  );
  const resultSchemaJsonSchema = entry.resultSchema
    ? sanitizeToolJsonSchema(
        z.toJSONSchema(entry.resultSchema as any, { io: "output" }) as JsonObject,
      )
    : undefined;
  ensureRootObjectSchema(launchInputJsonSchema, entry.workflowId);

  return {
    workflowId: entry.workflowId,
    label: entry.label,
    summary: entry.summary,
    sourceScope: entry.sourceScope,
    entryPath: entry.entryPath,
    productKind: entry.productKind,
    definitionPaths: entry.definitionPaths.slice(),
    promptPaths: entry.promptPaths.slice(),
    componentPaths: entry.componentPaths.slice(),
    assetPaths: entry.assetPaths.slice(),
    launchSchema: entry.launchSchema,
    launchInputJsonSchema,
    resultSchemaJsonSchema,
  };
}

function assertValidWorkflowId(workflowId: string): void {
  if (!WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new Error(
      `Runnable Smithers workflow id ${workflowId} must match ${WORKFLOW_ID_PATTERN.source} so handlers can address it consistently through ${SMITHERS_RUN_WORKFLOW_TOOL_NAME}.`,
    );
  }
}

function ensureRootObjectSchema(schema: JsonObject, workflowId: string): void {
  if (schema.type !== "object") {
    throw new Error(
      `Runnable Smithers workflow ${workflowId} must expose an object launch schema so svvy can validate smithers.run_workflow input precisely before launch.`,
    );
  }
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
