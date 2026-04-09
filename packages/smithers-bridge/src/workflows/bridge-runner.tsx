/** @jsxImportSource smithers-orchestrator */
import { PiAgent, Workflow, createSmithers } from "smithers-orchestrator";
import { resolve } from "node:path";
import React from "react";
import { z } from "zod";

const taskSchema = z.object({
  id: z.string(),
  outputKey: z.string(),
  prompt: z.string(),
  agent: z.enum(["pi", "static", "verification"]),
  needsApproval: z.boolean().optional(),
  retryLimit: z.number().int().min(0).optional(),
  worktreePath: z.string().optional(),
  scopedContext: z
    .object({
      sessionHistory: z.array(z.string()),
      relevantPaths: z.array(z.string()),
      agentsInstructions: z.array(z.string()),
      relevantSkills: z.array(z.string()),
      priorEpisodeIds: z.array(z.string()),
    })
    .optional(),
  toolScope: z
    .object({
      allow: z.array(z.string()),
      deny: z.array(z.string()).optional(),
      writeRoots: z.array(z.string()).optional(),
      readOnly: z.boolean().optional(),
    })
    .optional(),
  completionCondition: z
    .object({
      type: z.enum(["episode-produced", "verification-only", "needs-input"]),
      maxTurns: z.number().int().min(1).optional(),
    })
    .optional(),
});

const inputSchema = z.object({
  workflow: z.object({
    workflowId: z.string(),
    objective: z.string(),
    tasks: z.array(taskSchema).default([]),
  }),
  objective: z.string(),
  cwd: z.string().optional(),
  worktreePath: z.string().optional(),
});

const outputSchema = z
  .object({
    workflowId: z.string().optional(),
    objective: z.string().optional(),
    taskCount: z.number().int().nonnegative().optional(),
    completedTaskIds: z.array(z.string()).optional(),
    taskId: z.string().optional(),
    outputKey: z.string().optional(),
    agent: z.string().optional(),
    prompt: z.string().optional(),
    cwd: z.string().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
  })
  .passthrough();

const { smithers } = createSmithers(
  { result: outputSchema },
  {
    dbPath: process.env.HELLM_SMITHERS_DB_PATH ?? "./smithers.db",
  },
);

function resolveTaskCwd(input: z.infer<typeof inputSchema>, task: z.infer<typeof taskSchema>): string {
  return resolve(task.worktreePath ?? input.worktreePath ?? input.cwd ?? process.cwd());
}

function getAllowedTools(task: z.infer<typeof taskSchema>): string[] {
  const allow = task.toolScope?.allow ?? [];
  const deny = new Set(task.toolScope?.deny ?? []);
  const filtered = allow.filter((tool) => !deny.has(tool));
  if (!task.toolScope?.readOnly) {
    return filtered;
  }
  return filtered.filter((tool) => tool !== "edit" && tool !== "bash");
}

function materializeTaskPrompt(input: z.infer<typeof inputSchema>, task: z.infer<typeof taskSchema>): string {
  const boundaries = {
    workflowId: input.workflow.workflowId,
    taskId: task.id,
    outputKey: task.outputKey,
    worktreePath: task.worktreePath ?? input.worktreePath ?? null,
    toolScope: task.toolScope ?? null,
    completionCondition: task.completionCondition ?? null,
    scopedContext: task.scopedContext ?? null,
  };
  return `${task.prompt}\n\n[hellm-task-boundaries]\n${JSON.stringify(boundaries, null, 2)}`;
}

async function runVerificationTask(
  input: z.infer<typeof inputSchema>,
  task: z.infer<typeof taskSchema>,
): Promise<Record<string, unknown>> {
  const cwd = resolveTaskCwd(input, task);
  const proc = Bun.spawn(["/bin/sh", "-lc", task.prompt], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      HELLM_WORKFLOW_ID: input.workflow.workflowId,
      HELLM_TASK_ID: task.id,
      HELLM_TOOL_SCOPE: JSON.stringify(task.toolScope ?? {}),
      HELLM_SCOPED_CONTEXT: JSON.stringify(task.scopedContext ?? {}),
      HELLM_COMPLETION_CONDITION: JSON.stringify(task.completionCondition ?? {}),
    },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `Verification task "${task.id}" failed with exit code ${exitCode}: ${stderr || stdout}`,
    );
  }

  return {
    taskId: task.id,
    outputKey: task.outputKey,
    objective: input.workflow.objective,
    agent: task.agent,
    cwd,
    prompt: task.prompt,
    exitCode,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    toolScope: task.toolScope ?? null,
    completionCondition: task.completionCondition ?? null,
  };
}

function materializeTaskNode(
  input: z.infer<typeof inputSchema>,
  task: z.infer<typeof taskSchema>,
): React.ReactElement {
  const retries = task.retryLimit ?? 0;
  const needsApproval = task.needsApproval ?? false;

  if (task.agent === "pi") {
    const agent = new PiAgent({
      cwd: resolveTaskCwd(input, task),
      tools: getAllowedTools(task),
      noSession: true,
      print: true,
      env: {
        HELLM_WORKFLOW_ID: input.workflow.workflowId,
        HELLM_TASK_ID: task.id,
        HELLM_TOOL_SCOPE: JSON.stringify(task.toolScope ?? {}),
        HELLM_SCOPED_CONTEXT: JSON.stringify(task.scopedContext ?? {}),
        HELLM_COMPLETION_CONDITION: JSON.stringify(task.completionCondition ?? {}),
      },
    });

    return React.createElement(
      "smithers:task",
      {
        key: task.id,
        id: task.id,
        output: "result",
        agent,
        retries,
        needsApproval,
        __smithersKind: "agent",
      },
      materializeTaskPrompt(input, task),
    );
  }

  if (task.agent === "verification") {
    return React.createElement("smithers:task", {
      key: task.id,
      id: task.id,
      output: "result",
      retries,
      needsApproval,
      __smithersKind: "compute",
      __smithersComputeFn: () => runVerificationTask(input, task),
    });
  }

  const payload = {
    taskId: task.id,
    outputKey: task.outputKey,
    objective: input.workflow.objective,
    agent: task.agent,
    prompt: task.prompt,
    cwd: resolveTaskCwd(input, task),
    scopedContext: task.scopedContext ?? null,
    toolScope: task.toolScope ?? null,
    completionCondition: task.completionCondition ?? null,
  };
  return React.createElement("smithers:task", {
    key: task.id,
    id: task.id,
    output: "result",
    retries,
    needsApproval,
    __smithersKind: "static",
    __smithersPayload: payload,
    __payload: payload,
  });
}

export default smithers((ctx) => {
  const input = inputSchema.parse(ctx.input ?? {});
  const taskIds = input.workflow.tasks.map((task) => task.id);

  return (
    <Workflow
      name={`hellm-bridge:${input.workflow.workflowId}`}
      cache={false}
    >
      {input.workflow.tasks.map((task) => materializeTaskNode(input, task))}
      {React.createElement("smithers:task", {
        key: "workflow-result",
        id: "workflow-result",
        output: "result",
        dependsOn: taskIds,
        __smithersKind: "static",
        __smithersPayload: {
          workflowId: input.workflow.workflowId,
          objective: input.workflow.objective,
          taskCount: input.workflow.tasks.length,
          completedTaskIds: taskIds,
        },
        __payload: {
          workflowId: input.workflow.workflowId,
          objective: input.workflow.objective,
          taskCount: input.workflow.tasks.length,
          completedTaskIds: taskIds,
        },
      })}
    </Workflow>
  );
});
