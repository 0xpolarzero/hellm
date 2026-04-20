import React from "react";
import { createSmithers, type AgentLike, type SmithersWorkflow } from "smithers-orchestrator";
import { z } from "zod";
import { readSmithersWorkflowInput, smithersRuntimeInputSchema } from "./runtime-input";

export type BundledWorkflowDefinition = {
  id: string;
  label: string;
  description: string;
  workflowName: string;
  inputSchema: z.ZodTypeAny;
  workflow: SmithersWorkflow<any>;
};

type CreateBundledWorkflowRegistryOptions = {
  dbPath: string;
  createWorkflowTaskAgent: () => AgentLike;
};

export function createBundledWorkflowRegistry(
  options: CreateBundledWorkflowRegistryOptions,
): BundledWorkflowDefinition[] {
  return [
    createHelloWorldWorkflow(options.dbPath),
    createTaskAgentWorkflow(options.dbPath, options.createWorkflowTaskAgent),
  ];
}

function createHelloWorldWorkflow(dbPath: string): BundledWorkflowDefinition {
  const inputSchema = z.object({
    message: z.string().min(1).default("hello world"),
  });
  const greetingSchema = z.object({
    message: z.string(),
  });
  const resultSchema = z.object({
    summary: z.string(),
    message: z.string(),
  });

  const smithersApi = createSmithers(
    {
      input: smithersRuntimeInputSchema,
      greeting: greetingSchema,
      helloWorldResult: resultSchema,
    },
    { dbPath },
  );

  return {
    id: "hello_world",
    label: "Hello World",
    description: "Smoke-test bundled runtime wiring with a minimal static Smithers workflow.",
    workflowName: "svvy-hello-world",
    inputSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readSmithersWorkflowInput(inputSchema, ctx.input);
      const greeting = getLatestOutput<z.infer<typeof greetingSchema>>(ctx.outputs.greeting);
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-hello-world" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(smithersApi.Task, {
            id: "greeting",
            output: smithersApi.outputs.greeting,
            children: {
              message: workflowInput.message,
            },
          }),
          React.createElement(smithersApi.Task, {
            id: "result",
            output: smithersApi.outputs.helloWorldResult,
            children: {
              summary: `Generated greeting "${greeting?.message ?? workflowInput.message}".`,
              message: greeting?.message ?? workflowInput.message,
            },
          }),
        ),
      );
    }),
  };
}

function createTaskAgentWorkflow(
  dbPath: string,
  createWorkflowTaskAgent: () => AgentLike,
): BundledWorkflowDefinition {
  const inputSchema = z.object({
    objective: z.string().min(1),
    successCriteria: z.array(z.string().min(1)).default([]),
    validationCommands: z.array(z.string().min(1)).default([]),
  });
  const taskResultSchema = z.object({
    status: z.enum(["completed", "needs-human", "blocked"]),
    summary: z.string(),
    filesChanged: z.array(z.string()),
    validationRan: z.array(z.string()),
    unresolvedIssues: z.array(z.string()),
  });
  const resultSchema = z.object({
    status: z.enum(["completed", "needs-human", "blocked"]),
    summary: z.string(),
    filesChanged: z.array(z.string()),
    validationRan: z.array(z.string()),
    unresolvedIssues: z.array(z.string()),
  });

  const smithersApi = createSmithers(
    {
      input: smithersRuntimeInputSchema,
      taskResult: taskResultSchema,
      workflowResult: resultSchema,
    },
    { dbPath },
  );
  const taskAgent = createWorkflowTaskAgent();

  return {
    id: "execute_typescript_task",
    label: "Execute TypeScript Task",
    description:
      "Run one PI-backed Smithers task agent with execute_typescript as its only callable product tool.",
    workflowName: "svvy-execute-typescript-task",
    inputSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readSmithersWorkflowInput(inputSchema, ctx.input);
      const latestResult = getLatestOutput<z.infer<typeof taskResultSchema>>(
        ctx.outputs.taskResult,
      );
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-execute-typescript-task" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(
            smithersApi.Task,
            {
              id: "task",
              output: smithersApi.outputs.taskResult,
              agent: taskAgent,
              timeoutMs: 20 * 60 * 1000,
              heartbeatTimeoutMs: 2 * 60 * 1000,
            },
            buildTaskPrompt({
              objective: workflowInput.objective,
              successCriteria: workflowInput.successCriteria,
              validationCommands: workflowInput.validationCommands,
            }),
          ),
          React.createElement(smithersApi.Task, {
            id: "result",
            output: smithersApi.outputs.workflowResult,
            children: {
              status: latestResult?.status ?? "blocked",
              summary:
                latestResult?.summary ?? "The workflow task did not return a structured result.",
              filesChanged: latestResult?.filesChanged ?? [],
              validationRan: latestResult?.validationRan ?? [],
              unresolvedIssues: latestResult?.unresolvedIssues ?? [
                "Workflow task did not produce a valid structured result.",
              ],
            },
          }),
        ),
      );
    }),
  };
}

function buildTaskPrompt(input: {
  objective: string;
  successCriteria: string[];
  validationCommands: string[];
}): string {
  const parts = [
    "Complete the following repository task inside svvy.",
    `Objective:\n${input.objective}`,
    input.successCriteria.length > 0
      ? `Success criteria:\n${input.successCriteria.map((entry) => `- ${entry}`).join("\n")}`
      : "",
    input.validationCommands.length > 0
      ? `Validation commands to run when they are relevant:\n${input.validationCommands
          .map((entry) => `- ${entry}`)
          .join("\n")}`
      : "",
    "Use execute_typescript for repository work.",
    "Return exactly one JSON object with this shape and no extra text:",
    JSON.stringify(
      {
        status: "completed | needs-human | blocked",
        summary: "short summary",
        filesChanged: ["relative/path.ts"],
        validationRan: ["bun test path/to/test.ts"],
        unresolvedIssues: ["issue that still blocks completion"],
      },
      null,
      2,
    ),
  ].filter(Boolean);

  return parts.join("\n\n");
}

function getLatestOutput<T>(entries: T[] | undefined): T | null {
  return entries && entries.length > 0 ? (entries[entries.length - 1] ?? null) : null;
}
