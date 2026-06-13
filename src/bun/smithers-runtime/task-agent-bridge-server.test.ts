import { describe, expect, it } from "bun:test";
import {
  handleWorkflowTaskAgentBridgeRequest,
  type WorkflowTaskAgentBridgeRequest,
} from "./task-agent-bridge-server";

describe("workflow task-agent bridge server", () => {
  it("accepts generated Smithers payload shapes and binds auth to the source command", async () => {
    const received: WorkflowTaskAgentBridgeRequest[] = [];
    const bridge = {
      authorize: (request: WorkflowTaskAgentBridgeRequest, bearerToken: string) =>
        bearerToken === `${request.workspaceSessionId}:${request.sourceCommandId}`,
      async runTaskAgent(request: WorkflowTaskAgentBridgeRequest) {
        received.push(request);
        return { text: "done", output: { ok: true } };
      },
    };

    const response = await handleWorkflowTaskAgentBridgeRequest({
      ...bridge,
      token: "fallback-token",
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer workspace-1:command-1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "runTaskAgent",
          workspaceSessionId: "workspace-1",
          sourceCommandId: "command-1",
          taskAgent: {
            id: "reviewerAgent",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "medium",
            overrides: { workflows: "loaded" },
          },
          taskContext: { taskId: "task-review" },
          run: { id: "smithers-run-1" },
          node: { id: "node-review" },
          iteration: { index: 2 },
          attempt: { index: 1 },
          messages: [{ role: "user", content: "Review this." }],
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "done", output: { ok: true } });
    expect(received).toEqual([
      {
        workspaceSessionId: "workspace-1",
        sourceCommandId: "command-1",
        taskContext: {
          runId: "smithers-run-1",
          nodeId: "node-review",
          iteration: 2,
          attempt: 1,
        },
        agent: {
          id: "reviewerAgent",
          label: undefined,
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: undefined,
          overrides: { workflows: "loaded" },
        },
        prompt: undefined,
        messages: [{ role: "user", text: "Review this." }],
        rootDir: undefined,
      },
    ]);

    const forged = await handleWorkflowTaskAgentBridgeRequest({
      ...bridge,
      token: "fallback-token",
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer workspace-1:command-1",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "runTaskAgent",
          workspaceSessionId: "workspace-1",
          sourceCommandId: "command-2",
          taskAgent: {
            id: "reviewerAgent",
            provider: "openai",
            model: "gpt-5.4",
            reasoningEffort: "medium",
          },
          smithersRunId: "smithers-run-2",
          nodeId: "node-review",
          iteration: 0,
          attempt: 0,
          prompt: "Review.",
        }),
      }),
    });

    expect(forged.status).toBe(401);
    expect(received).toHaveLength(1);
  });
});
