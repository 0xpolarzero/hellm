import { createHash } from "node:crypto";
import { Type } from "@mariozechner/pi-ai";
import type { TSchema } from "@sinclair/typebox";
import { z } from "zod";
import type { RunnableWorkflowRegistryEntry } from "./workflow-registry";

export const SMITHERS_RUN_WORKFLOW_TOOL_NAME = "smithers.run_workflow";

export type RunnableWorkflowLaunchContract = {
  workflowId: string;
  label: string;
  summary: string;
  sourceScope: RunnableWorkflowRegistryEntry["sourceScope"];
  entryPath: string;
  definitionPaths: string[];
  promptPaths: string[];
  componentPaths: string[];
  assetPaths: string[];
  semanticToolName: typeof SMITHERS_RUN_WORKFLOW_TOOL_NAME;
  launchToolName: `smithers.run_workflow.${string}`;
  launchSchema: z.ZodTypeAny;
  launchInputJsonSchema: Record<string, unknown>;
  launchToolParameters: TSchema;
  contractHash: string;
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
  ensureRootObjectSchema(launchInputJsonSchema, entry.workflowId);

  const launchToolName = `${SMITHERS_RUN_WORKFLOW_TOOL_NAME}.${entry.workflowId}` as const;
  const contractHash = createStableHash({
    workflowId: entry.workflowId,
    label: entry.label,
    summary: entry.summary,
    sourceScope: entry.sourceScope,
    entryPath: entry.entryPath,
    definitionPaths: entry.definitionPaths,
    promptPaths: entry.promptPaths,
    componentPaths: entry.componentPaths,
    assetPaths: entry.assetPaths,
    semanticToolName: SMITHERS_RUN_WORKFLOW_TOOL_NAME,
    launchToolName,
    launchInputJsonSchema,
  });

  return {
    workflowId: entry.workflowId,
    label: entry.label,
    summary: entry.summary,
    sourceScope: entry.sourceScope,
    entryPath: entry.entryPath,
    definitionPaths: entry.definitionPaths.slice(),
    promptPaths: entry.promptPaths.slice(),
    componentPaths: entry.componentPaths.slice(),
    assetPaths: entry.assetPaths.slice(),
    semanticToolName: SMITHERS_RUN_WORKFLOW_TOOL_NAME,
    launchToolName,
    launchSchema: entry.launchSchema,
    launchInputJsonSchema,
    launchToolParameters: Type.Unsafe(launchInputJsonSchema) as TSchema,
    contractHash,
  };
}

export function createWorkflowToolSurfaceVersion(
  contracts: readonly RunnableWorkflowLaunchContract[],
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
      `Runnable Smithers workflow id ${workflowId} must match ${WORKFLOW_ID_PATTERN.source} so svvy can generate a stable smithers.run_workflow.<workflow_id> tool name.`,
    );
  }
}

function ensureRootObjectSchema(schema: JsonObject, workflowId: string): void {
  if (schema.type !== "object") {
    throw new Error(
      `Runnable Smithers workflow ${workflowId} must expose an object launch schema so svvy can generate a workflow launch tool.`,
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

function createStableHash(value: unknown): string {
  return createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function stableJsonStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJsonStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonObject).toSorted(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJsonStringify(entryValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}
