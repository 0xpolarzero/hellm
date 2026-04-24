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
import { createDefaultWorkflowTaskAgentProfile } from "./workflow-task-agent-profile";
import type {
  ExecuteTypescriptRunCommandInput,
  ExecuteTypescriptRunCommandResult,
  ExecuteTypescriptWebFetchResult,
  ExecuteTypescriptWebSearchResult,
} from "../execute-typescript-tool";
import type { StructuredSessionStateStore } from "../structured-session-state";

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
  store: StructuredSessionStateStore;
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
    workspaceRoot: input.cwd,
    agentDir: input.agentDir,
    artifactDir: input.artifactDir,
    store: input.store,
    profile: createDefaultWorkflowTaskAgentProfile({
      provider: input.provider,
      model: input.model,
      thinkingLevel: input.thinkingLevel,
    }),
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

export function createTranscriptProbeTestWorkflow(dbPath: string): TestWorkflowDefinition {
  const launchSchema = z.object({
    prompt: z.string().min(1).default("Summarize the latest transcript probe."),
  });
  const transcriptReplySchema = z.object({
    reply: z.string(),
    promptEcho: z.string(),
  });
  const resultSchema = z.object({
    summary: z.string(),
    reply: z.string(),
  });

  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
      transcriptReply: transcriptReplySchema,
      transcriptResult: resultSchema,
    },
    { dbPath },
  );
  const transcriptAgent: AgentLike = {
    id: "svvy-deterministic-transcript-agent",
    async generate(rawArgs: unknown) {
      const args = rawArgs as {
        prompt?: string;
        onStdout?: (chunk: string) => void;
        onStepFinish?: (step: {
          response: { messages: Array<{ role: string; content: string }> };
        }) => void;
      };
      const promptText =
        typeof args.prompt === "string" && args.prompt.trim().length > 0
          ? args.prompt.trim()
          : "No prompt provided.";
      const response = {
        reply: `Handled: ${promptText}`,
        promptEcho: promptText,
      };
      const responseText = JSON.stringify(response);
      args.onStdout?.(responseText);
      args.onStepFinish?.({
        response: {
          messages: [{ role: "assistant", content: responseText }],
        },
      });
      return {
        text: responseText,
        output: response,
        response: {
          messages: [{ role: "assistant", content: responseText }],
        },
      };
    },
  };

  return {
    id: "chat_transcript_probe",
    label: "Chat Transcript Probe",
    summary:
      "Runs a deterministic agent task so transcript inspection can read real attempt history.",
    workflowName: "svvy-chat-transcript-probe",
    launchSchema,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
      const reply = getLatestOutput<z.infer<typeof transcriptReplySchema>>(
        ctx.outputs.transcriptReply,
      );
      return React.createElement(
        smithersApi.Workflow,
        { name: "svvy-chat-transcript-probe" },
        React.createElement(
          smithersApi.Sequence,
          null,
          React.createElement(
            smithersApi.Task,
            {
              id: "assistant",
              output: smithersApi.outputs.transcriptReply,
              agent: transcriptAgent,
            },
            workflowInput.prompt,
          ),
          reply
            ? React.createElement(smithersApi.Task, {
                id: "result",
                output: smithersApi.outputs.transcriptResult,
                children: {
                  summary: `Captured transcript reply for prompt "${reply.promptEcho}".`,
                  reply: reply.reply,
                },
              })
            : null,
        ),
      );
    }),
    sourceScope: "saved",
    entryPath: ".svvy/workflows/entries/chat-transcript-probe.tsx",
  };
}

export const testProjectCiResultSchema = z.object({
  status: z.enum(["passed", "failed", "cancelled", "blocked"]),
  summary: z.string().min(1),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  checks: z.array(
    z.object({
      checkId: z.string().min(1),
      label: z.string().min(1),
      kind: z.string().min(1),
      status: z.enum(["passed", "failed", "cancelled", "skipped", "blocked"]),
      required: z.boolean().default(true),
      command: z.array(z.string()).optional(),
      exitCode: z.number().int().nullable().optional(),
      summary: z.string().min(1),
      artifactIds: z.array(z.string()).default([]),
      startedAt: z.string().nullable().optional(),
      finishedAt: z.string().nullable().optional(),
    }),
  ),
});
const invalidTestProjectCiResultSchema = testProjectCiResultSchema.extend({
  validatorToken: z.literal("valid"),
});

export function createProjectCiTestWorkflow(input: {
  dbPath: string;
  validOutput?: boolean;
  id?: string;
  productKind?: "project-ci";
}): TestWorkflowDefinition {
  const launchSchema = z.object({
    scope: z.enum(["fast", "full", "release"]).default("fast"),
    reason: z.string().optional(),
  });
  const smithersApi = createSmithers(
    {
      input: bundledWorkflowRuntimeStoredInputSchema,
      output: testProjectCiResultSchema,
    },
    { dbPath: input.dbPath },
  );
  const workflowId = input.id ?? "project_ci";

  return {
    id: workflowId,
    label: input.productKind ? "Project CI" : "Project CI Lookalike",
    summary: input.productKind
      ? "Test Project CI workflow."
      : "Non-CI workflow with CI-shaped output.",
    launchSchema,
    productKind: input.productKind,
    resultSchema: input.productKind
      ? input.validOutput === false
        ? invalidTestProjectCiResultSchema
        : testProjectCiResultSchema
      : undefined,
    workflow: smithersApi.smithers((ctx) => {
      const workflowInput = readBundledWorkflowLaunchInput(launchSchema, ctx.input);
      const validResult = {
        status: workflowInput.scope === "release" ? "blocked" : "passed",
        summary: `Project CI ${workflowInput.scope} checks passed.`,
        checks: [
          {
            checkId: "typecheck",
            label: "Typecheck",
            kind: "typecheck",
            status: "passed",
            required: true,
            command: ["bun", "run", "typecheck"],
            exitCode: 0,
            summary: "Typecheck passed.",
            artifactIds: [],
          },
        ],
      };
      return React.createElement(
        smithersApi.Workflow,
        { name: input.productKind ? "svvy-project-ci" : "svvy-project-ci-lookalike" },
        React.createElement(smithersApi.Task, {
          id: "result",
          output: smithersApi.outputs.output,
          children:
            input.validOutput === false
              ? {
                  ...validResult,
                  summary: `Project CI ${workflowInput.scope} checks reported an invalid terminal contract.`,
                }
              : validResult,
        }),
      );
    }),
    sourceScope: "saved",
    entryPath: input.productKind
      ? ".svvy/workflows/entries/ci/project-ci.tsx"
      : ".svvy/workflows/entries/ci-looking-workflow.tsx",
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
