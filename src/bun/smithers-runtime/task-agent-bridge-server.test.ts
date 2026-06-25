import { describe, expect, it } from "bun:test";
import type { RunTaskAgentInput } from "@svvy/core";
import { handleRunTaskAgentRequest } from "./task-agent-bridge-server";

describe("workflow task-agent bridge server", () => {
  it("accepts generated Smithers payload shapes and binds auth to the source command", async () => {
    const received: unknown[] = [];
    const bridge = {
      authorize: (request: RunTaskAgentInput, bearerToken: string) =>
        bearerToken === `${request.workspaceSessionId}:${request.sourceCommandId}`,
      async runTaskAgent(request: RunTaskAgentInput) {
        received.push(request);
        return { text: "done", output: { ok: true } };
      },
    };

    const response = await handleRunTaskAgentRequest({
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
          agent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
            overrides: { workflows: "loaded" },
          },
          taskIdentity: {
            runId: "smithers-run-1",
            nodeId: "node-review",
            iteration: 2,
            attempt: 1,
          },
          smithersContext: {
            run: { id: "smithers-run-1" },
            node: { id: "node-review" },
          },
          promptSource: {
            kind: "messages",
            messages: [{ role: "user", text: "Review this." }],
          },
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "done", output: { ok: true } });
    expect(received).toEqual([
      {
        workspaceSessionId: "workspace-1",
        sourceCommandId: "command-1",
        operation: "runTaskAgent",
        taskIdentity: {
          runId: "smithers-run-1",
          nodeId: "node-review",
          iteration: 2,
          attempt: 1,
        },
        smithersContext: {
          run: { id: "smithers-run-1" },
          node: { id: "node-review" },
        },
        agent: {
          id: "reviewerAgent",
          label: "Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoning: { effort: "medium" },
          instructions: "Review strictly.",
          overrides: { workflows: "loaded" },
        },
        promptSource: {
          kind: "messages",
          messages: [{ role: "user", text: "Review this." }],
        },
      },
    ]);

    const forged = await handleRunTaskAgentRequest({
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
          agent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
          },
          taskIdentity: {
            runId: "smithers-run-2",
            nodeId: "node-review",
            iteration: 0,
            attempt: 0,
          },
          promptSource: {
            kind: "prompt",
            prompt: "Review.",
          },
        }),
      }),
    });

    expect(forged.status).toBe(401);
    expect(await forged.json()).toEqual({
      error: "unauthorized",
      message: "Unauthorized workflow task-agent bridge request.",
      retryable: false,
      workspaceSessionId: "workspace-1",
      sourceCommandId: "command-2",
    });
    expect(received).toHaveLength(1);
  });

  it("rejects system-role bridge messages", async () => {
    const response = await handleRunTaskAgentRequest({
      token: "bridge-token",
      async runTaskAgent() {
        return { text: "unreachable" };
      },
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "runTaskAgent",
          workspaceSessionId: "workspace-1",
          sourceCommandId: "command-1",
          agent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
          },
          taskIdentity: {
            runId: "smithers-run-1",
            nodeId: "node-review",
            iteration: 0,
            attempt: 0,
          },
          promptSource: {
            kind: "messages",
            messages: [{ role: "system", text: "Hidden system content." }],
          },
        }),
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "invalid_request",
      retryable: false,
    });
    expect(body.message).toContain('"user" | "assistant"');
  });

  it("rejects obsolete task-agent bridge request surfaces", async () => {
    const basePayload = {
      operation: "runTaskAgent",
      workspaceSessionId: "workspace-1",
      sourceCommandId: "command-1",
      taskIdentity: {
        runId: "smithers-run-1",
        nodeId: "node-review",
        iteration: 0,
        attempt: 0,
      },
      promptSource: {
        kind: "prompt",
        prompt: "Review.",
      },
    };
    const bridge = {
      token: "bridge-token",
      async runTaskAgent() {
        return { text: "unreachable" };
      },
    };

    const legacyAgent = await handleRunTaskAgentRequest({
      ...bridge,
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...basePayload,
          taskAgent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
          },
        }),
      }),
    });

    expect(legacyAgent.status).toBe(400);
    const legacyAgentBody = await legacyAgent.json();
    expect(legacyAgentBody).toMatchObject({
      error: "invalid_request",
      retryable: false,
    });
    expect(legacyAgentBody.message).toContain("Missing key");
    expect(legacyAgentBody.message).toContain('["agent"]');

    const topLevelPrompt = await handleRunTaskAgentRequest({
      ...bridge,
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...basePayload,
          agent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
          },
          prompt: "Review.",
        }),
      }),
    });

    expect(topLevelPrompt.status).toBe(400);
    const topLevelPromptBody = await topLevelPrompt.json();
    expect(topLevelPromptBody).toMatchObject({
      error: "invalid_request",
      retryable: false,
    });
    expect(topLevelPromptBody.message).toContain("Unexpected key");
    expect(topLevelPromptBody.message).toContain('["prompt"]');
  });

  it("rejects runtime-owned runTaskAgent source fields before auth or execution", async () => {
    let authorizeCalls = 0;
    let runTaskAgentCalls = 0;
    const response = await handleRunTaskAgentRequest({
      token: "bridge-token",
      authorize() {
        authorizeCalls += 1;
        return true;
      },
      async runTaskAgent() {
        runTaskAgentCalls += 1;
        return { text: "unreachable" };
      },
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "runTaskAgent",
          workspaceSessionId: "workspace-1",
          sourceCommandId: "command-1",
          workflowTaskAttemptId: "workflow-task-attempt-1",
          surfacePiSessionId: "pi-session-1",
          agent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
          },
          taskIdentity: {
            runId: "smithers-run-1",
            nodeId: "node-review",
            iteration: 0,
            attempt: 0,
          },
          promptSource: {
            kind: "prompt",
            prompt: "Review.",
          },
        }),
      }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: "invalid_request",
      retryable: false,
    });
    expect(body.message).toContain("Unexpected key");
    expect(authorizeCalls).toBe(0);
    expect(runTaskAgentCalls).toBe(0);
  });

  it("returns typed task-attempt failures for runtime execution errors", async () => {
    const response = await handleRunTaskAgentRequest({
      token: "bridge-token",
      async runTaskAgent() {
        throw new Error("Task execution failed.");
      },
      request: new Request("http://127.0.0.1/runTaskAgent", {
        method: "POST",
        headers: {
          authorization: "Bearer bridge-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operation: "runTaskAgent",
          workspaceSessionId: "workspace-1",
          sourceCommandId: "command-1",
          agent: {
            id: "reviewerAgent",
            label: "Reviewer",
            provider: "openai",
            model: "gpt-5.4",
            reasoning: { effort: "medium" },
            instructions: "Review strictly.",
          },
          taskIdentity: {
            runId: "smithers-run-1",
            nodeId: "node-review",
            iteration: 0,
            attempt: 0,
          },
          promptSource: {
            kind: "prompt",
            prompt: "Review.",
          },
        }),
      }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "task_attempt_failed",
      message: "Task execution failed.",
      retryable: true,
      workspaceSessionId: "workspace-1",
      sourceCommandId: "command-1",
    });
  });
});
