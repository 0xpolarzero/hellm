import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import React from "react";
import { createSmithers, type AgentLike } from "smithers-orchestrator";
import { z } from "zod";
import type { TestWorkflowDefinition } from "./manager";
import {
  bundledWorkflowRuntimeStoredInputSchema,
  readBundledWorkflowLaunchInput,
} from "./runtime-input";
import { createWorkflowTaskAgent } from "./workflow-task-agent";
import type {
  ExecuteTypescriptRunCommandInput,
  ExecuteTypescriptRunCommandResult,
  ExecuteTypescriptWebFetchResult,
  ExecuteTypescriptWebSearchResult,
} from "../execute-typescript-tool";

function getLatestOutput<T>(entries: T[] | undefined): T | null {
  return entries && entries.length > 0 ? (entries[entries.length - 1] ?? null) : null;
}

export function createHelloWorldTestWorkflow(dbPath: string): TestWorkflowDefinition {
  const launchSchema = z.object({
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
      input: bundledWorkflowRuntimeStoredInputSchema,
      greeting: greetingSchema,
      helloWorldResult: resultSchema,
    },
    { dbPath },
  );

  return {
    id: "hello_world",
    label: "Hello World",
    summary: "Smoke-test workflow used by Smithers runtime tests.",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
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
    sourceScope: "saved",
    entryPath: ".svvy/workflows/entries/hello-world.tsx",
  };
}

export function createExecuteTypescriptTaskTestWorkflow(input: {
  dbPath: string;
  cwd: string;
  agentDir: string;
  artifactDir: string;
  provider: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  runCommand?: (
    args: ExecuteTypescriptRunCommandInput,
  ) => Promise<ExecuteTypescriptRunCommandResult>;
  webSearch?: (args: {
    query: string;
    maxResults?: number;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebSearchResult>;
  fetchText?: (args: {
    url: string;
    signal?: AbortSignal;
  }) => Promise<ExecuteTypescriptWebFetchResult>;
}): TestWorkflowDefinition {
  const launchSchema = z.object({
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
      input: bundledWorkflowRuntimeStoredInputSchema,
      taskResult: taskResultSchema,
      workflowResult: resultSchema,
    },
    { dbPath: input.dbPath },
  );
  const taskAgent: AgentLike = createWorkflowTaskAgent({
    cwd: input.cwd,
    agentDir: input.agentDir,
    artifactDir: input.artifactDir,
    provider: input.provider,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    runCommand: input.runCommand,
    webSearch: input.webSearch,
    fetchText: input.fetchText,
  });

  return {
    id: "execute_typescript_task",
    label: "Execute TypeScript Task",
    summary:
      "Run one PI-backed workflow task agent with execute_typescript as its only product tool.",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
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
    sourceScope: "saved",
    entryPath: ".svvy/workflows/entries/execute-typescript-task.tsx",
  };
}

function buildTaskPrompt(input: {
  objective: string;
  successCriteria: string[];
  validationCommands: string[];
}): string {
  return [
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
  ]
    .filter(Boolean)
    .join("\n\n");
}
