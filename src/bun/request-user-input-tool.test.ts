import { afterEach, describe, expect, it } from "bun:test";
import { createPromptExecutionContext } from "./prompt-execution-context";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "./structured-session-state";
import { createRequestUserInputTool, RequestUserInputRuntime } from "./request-user-input-tool";
import { buildStructuredSessionView } from "./structured-session-selectors";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

const stores: StructuredSessionStateStore[] = [];

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});

describe("request_user_input tool", () => {
  it("uses active variant-specific tool descriptions and schema descriptions", () => {
    const { store, runtime } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();

    const nonblockingTool = createRequestUserInputTool({
      store,
      runtime,
      requestUserInputRuntime,
    });
    expect(nonblockingTool.description).toContain(
      "Returns recommended/default answers immediately",
    );
    expect(JSON.stringify(nonblockingTool.parameters)).toContain("returns immediately");

    requestUserInputRuntime.setSettings({
      mode: "blocking",
      blockingTimeout: { enabled: true, durationMs: 300_000 },
    });
    const blockingTool = createRequestUserInputTool({
      store,
      runtime,
      requestUserInputRuntime,
    });
    expect(blockingTool.description).toContain("wait until the user answers");
    expect(JSON.stringify(blockingTool.parameters)).toContain("before proceeding");
    expect(blockingTool.description).not.toContain("later user answers arrive");
  });

  it("returns nonblocking default answers without internal runtime fields", async () => {
    const { store, runtime } = createHarness();
    const tool = createRequestUserInputTool({ store, runtime });

    const result = await tool.execute("tool-call-request-input", {
      questions: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite before handoff?",
          options: [
            {
              label: "Unit checks only",
              description: "Faster; catches local regressions.",
              recommended: true,
            },
            {
              label: "Full suite",
              description: "Slower; includes e2e behavior.",
            },
          ],
        },
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          defaultAnswer: "Concise engineering summary focused on user-visible changes.",
        },
      ],
    });

    expect(result.details).toEqual({
      answers: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite before handoff?",
          answer: {
            kind: "option",
            label: "Unit checks only",
            text: "Unit checks only",
          },
          answeredBy: "default",
        },
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          answer: {
            kind: "custom",
            text: "Concise engineering summary focused on user-visible changes.",
          },
          answeredBy: "default",
        },
      ],
    });
    expect(JSON.stringify(result.details)).not.toContain("requestId");
    expect(JSON.stringify(result.details)).not.toContain("questionId");
    expect(JSON.stringify(result.details)).not.toContain("optionId");
    expect(JSON.stringify(result.details)).not.toContain("mode");
    expect(JSON.stringify(result.details)).not.toContain("timer");

    const snapshot = store.getSessionState("session-request-input");
    expect(snapshot.turns[0]?.turnDecision).toBe("request_user_input");
    expect(snapshot.requestUserInputRequests).toHaveLength(1);
    expect(snapshot.requestUserInputRequests[0]).toMatchObject({
      sessionId: "session-request-input",
      surfacePiSessionId: "session-request-input",
      threadId: null,
      turnId: snapshot.turns[0]?.id,
      commandId: snapshot.commands[0]?.id,
      toolItemId: "tool-call-request-input",
      variant: "nonblocking",
      status: "open",
      completedAt: null,
    });
    expect(snapshot.requestUserInputRequests[0]?.requestId).toMatch(/^rui-/);
    expect(snapshot.requestUserInputRequests[0]?.questions).toEqual([
      expect.objectContaining({
        questionId: expect.stringMatching(/^ruiq-/),
        title: "CI scope",
        status: "open",
        choices: [
          expect.objectContaining({
            optionId: expect.stringMatching(/^ruio-/),
            label: "Unit checks only",
            recommended: true,
          }),
          expect.objectContaining({
            optionId: expect.stringMatching(/^ruio-/),
            label: "Full suite",
            recommended: false,
          }),
        ],
      }),
      expect.objectContaining({
        questionId: expect.stringMatching(/^ruiq-/),
        title: "Release note tone",
        status: "open",
        choices: [],
      }),
    ]);
    expect(snapshot.requestUserInputRequests[0]?.answers).toEqual([
      expect.objectContaining({
        answerId: expect.stringMatching(/^ruia-/),
        answeredBy: "default",
        delivery: null,
        queuedItemId: null,
      }),
      expect.objectContaining({
        answerId: expect.stringMatching(/^ruia-/),
        answeredBy: "default",
        delivery: null,
        queuedItemId: null,
      }),
    ]);
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "request_user_input",
        executor: "orchestrator",
        status: "succeeded",
        summary: "Defaulted answers for 2 questions.",
        arguments: {
          questions: [
            expect.objectContaining({
              title: "CI scope",
              question: "Should CI run only unit checks or the full suite before handoff?",
              options: [
                expect.objectContaining({
                  label: "Unit checks only",
                  recommended: true,
                }),
                expect.objectContaining({
                  label: "Full suite",
                }),
              ],
            }),
            expect.objectContaining({
              title: "Release note tone",
              question: "What release-note tone should I use?",
              defaultAnswer: "Concise engineering summary focused on user-visible changes.",
            }),
          ],
        },
        facts: {
          questionCount: 2,
          answeredBy: "default",
          result: {
            answers: [
              {
                title: "CI scope",
                question: "Should CI run only unit checks or the full suite before handoff?",
                answer: {
                  kind: "option",
                  label: "Unit checks only",
                  text: "Unit checks only",
                },
                answeredBy: "default",
              },
              {
                title: "Release note tone",
                question: "What release-note tone should I use?",
                answer: {
                  kind: "custom",
                  text: "Concise engineering summary focused on user-visible changes.",
                },
                answeredBy: "default",
              },
            ],
          },
        },
      }),
    ]);
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: "command.progress",
        subject: {
          kind: "command",
          id: snapshot.commands[0]!.id,
        },
        data: {
          source: "request_user_input",
          phase: "created",
          message: "Created 2 user-input questions.",
          facts: {
            requestId: snapshot.requestUserInputRequests[0]!.requestId,
            variant: "nonblocking",
            questionCount: 2,
          },
        },
      }),
    );
    expect(buildStructuredSessionView(snapshot).commandRollups[0]?.progressEvents).toEqual([
      expect.objectContaining({
        source: "request_user_input",
        phase: "created",
        message: "Created 2 user-input questions.",
        facts: {
          requestId: snapshot.requestUserInputRequests[0]!.requestId,
          variant: "nonblocking",
          questionCount: 2,
        },
      }),
    ]);
  });

  it("creates a waiting command record before a blocking answer arrives", async () => {
    const { store, runtime } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();
    requestUserInputRuntime.setSettings({
      mode: "blocking",
      blockingTimeout: { enabled: false, durationMs: 300_000 },
    });
    const tool = createRequestUserInputTool({ store, runtime, requestUserInputRuntime });

    const pending = tool.execute("tool-call-blocking-start", {
      questions: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite before handoff?",
          options: [
            {
              label: "Unit checks only",
              description: "Faster; catches local regressions.",
              recommended: true,
            },
            {
              label: "Full suite",
              description: "Slower; includes e2e behavior.",
            },
          ],
        },
      ],
    });
    await Promise.resolve();

    const snapshot = store.getSessionState("session-request-input");
    const request = snapshot.requestUserInputRequests[0]!;
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "request_user_input",
        status: "waiting",
        title: "Ask user: CI scope",
        facts: expect.objectContaining({
          questionCount: 1,
          answeredBy: "pending",
        }),
        finishedAt: null,
      }),
    ]);
    expect(snapshot.events).toContainEqual(
      expect.objectContaining({
        kind: "command.progress",
        subject: {
          kind: "command",
          id: snapshot.commands[0]!.id,
        },
        data: {
          source: "request_user_input",
          phase: "created",
          message: "Created 1 user-input question.",
          facts: {
            requestId: request.requestId,
            variant: "blocking",
            questionCount: 1,
          },
        },
      }),
    );
    expect(request).toMatchObject({
      toolItemId: "tool-call-blocking-start",
      commandId: snapshot.commands[0]!.id,
      variant: "blocking",
      status: "open",
    });

    const fullSuite = request.questions[0]!.choices.find(
      (choice) => choice.label === "Full suite",
    )!;
    store.answerRequestUserInput({
      sessionId: "session-request-input",
      surfacePiSessionId: "session-request-input",
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      answer: { kind: "option", optionId: fullSuite.optionId },
      delivery: "steer",
    });
    requestUserInputRuntime.resolveBlockingRequest(store, request.requestId);

    await expect(pending).resolves.toMatchObject({
      details: {
        answers: [expect.objectContaining({ answeredBy: "user" })],
      },
    });
  });

  it("rejects invalid question shapes", async () => {
    const { store, runtime } = createHarness();
    const tool = createRequestUserInputTool({ store, runtime });

    await expect(
      tool.execute("tool-call-missing-recommended", {
        questions: [
          {
            title: "CI scope",
            question: "Should CI run only unit checks or the full suite?",
            options: [
              {
                label: "Unit checks only",
                description: "Faster.",
              },
              {
                label: "Full suite",
                description: "Slower.",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("requires exactly one recommended option");

    await expect(
      tool.execute("tool-call-both-kinds", {
        questions: [
          {
            title: "CI scope",
            question: "Should CI run only unit checks or the full suite?",
            defaultAnswer: "Unit checks only.",
            options: [
              {
                label: "Unit checks only",
                description: "Faster.",
                recommended: true,
              },
              {
                label: "Full suite",
                description: "Slower.",
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("requires either options or defaultAnswer, but not both");

    await expect(
      tool.execute("tool-call-too-many", {
        questions: [
          { title: "One", question: "One?", defaultAnswer: "One." },
          { title: "Two", question: "Two?", defaultAnswer: "Two." },
          { title: "Three", question: "Three?", defaultAnswer: "Three." },
          { title: "Four", question: "Four?", defaultAnswer: "Four." },
        ],
      }),
    ).rejects.toThrow("requires one to three questions");

    await expect(
      tool.execute("tool-call-agent-ids", {
        questions: [
          {
            id: "agent-supplied-id",
            title: "CI scope",
            question: "Should CI run only unit checks or the full suite?",
            options: [
              {
                label: "Unit checks only",
                description: "Faster.",
                recommended: true,
              },
              {
                label: "Full suite",
                description: "Slower.",
              },
            ],
          },
        ],
      } as never),
    ).rejects.toThrow("unsupported field id");

    expect(
      store
        .getSessionState("session-request-input")
        .commands.map((command) => [command.toolName, command.status]),
    ).toEqual([
      ["request_user_input", "failed"],
      ["request_user_input", "failed"],
      ["request_user_input", "failed"],
      ["request_user_input", "failed"],
    ]);
    expect(
      store.getSessionState("session-request-input").commands.map((command) => command.facts),
    ).toEqual([null, null, null, null]);
  });

  it("records handler-owned clarification commands without orchestrator notification", async () => {
    const { store, runtime } = createHarness({ surfaceKind: "handler" });
    const tool = createRequestUserInputTool({ store, runtime });

    await tool.execute("tool-call-handler-request-input", {
      questions: [
        {
          title: "Repair direction",
          question: "Should I repair the failing workflow locally or report back now?",
          options: [
            {
              label: "Repair locally",
              description: "Keeps the handler responsible for the delegated objective.",
              recommended: true,
            },
            {
              label: "Report back",
              description: "Returns control before the local repair is complete.",
            },
          ],
        },
      ],
    });

    const snapshot = store.getSessionState("session-request-input");
    const rootThread = snapshot.threads[0]!;
    expect(snapshot.commands).toEqual([
      expect.objectContaining({
        toolName: "request_user_input",
        executor: "handler",
        threadId: rootThread.id,
      }),
    ]);
    expect(snapshot.requestUserInputRequests).toEqual([
      expect.objectContaining({
        surfacePiSessionId: rootThread.surfacePiSessionId,
        threadId: rootThread.id,
        toolItemId: "tool-call-handler-request-input",
        variant: "nonblocking",
      }),
    ]);
    expect(
      snapshot.queuedMessages?.some((message) => message.kind === "thread_report_notification"),
    ).toBe(false);
  });

  it("waits in blocking mode until the user answers through the request record", async () => {
    const { store, runtime } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();
    requestUserInputRuntime.setSettings({
      mode: "blocking",
      blockingTimeout: { enabled: false, durationMs: 300_000 },
    });
    const tool = createRequestUserInputTool({ store, runtime, requestUserInputRuntime });

    const pending = tool.execute("tool-call-blocking-request-input", {
      questions: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite before handoff?",
          options: [
            {
              label: "Unit checks only",
              description: "Faster; catches local regressions.",
              recommended: true,
            },
            {
              label: "Full suite",
              description: "Slower; includes e2e behavior.",
            },
          ],
        },
      ],
    });
    await Promise.resolve();

    const request = store.getSessionState("session-request-input").requestUserInputRequests[0]!;
    expect(request).toMatchObject({
      variant: "blocking",
      status: "open",
      timeout: {
        enabled: false,
        durationMs: 300_000,
        expiresAt: null,
      },
    });
    expect(store.getSessionState("session-request-input").commands[0]).toMatchObject({
      status: "waiting",
    });

    const fullSuite = request.questions[0]!.choices.find(
      (choice) => choice.label === "Full suite",
    )!;
    const answered = store.answerRequestUserInput({
      sessionId: "session-request-input",
      surfacePiSessionId: "session-request-input",
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      answer: { kind: "option", optionId: fullSuite.optionId },
      delivery: "steer",
    });
    expect(answered.queuedMessage).toBeNull();
    requestUserInputRuntime.resolveBlockingRequest(store, request.requestId);

    await expect(pending).resolves.toMatchObject({
      details: {
        answers: [
          {
            title: "CI scope",
            answer: {
              kind: "option",
              label: "Full suite",
              text: "Full suite",
            },
            answeredBy: "user",
          },
        ],
      },
    });
    expect(store.getSessionState("session-request-input").commands[0]).toMatchObject({
      status: "succeeded",
    });
    expect(
      store.listQueuedSurfaceMessages({ surfacePiSessionId: "session-request-input" }),
    ).toHaveLength(0);
  });

  it("uses timeout defaults for unanswered blocking questions", async () => {
    const { store, runtime } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();
    requestUserInputRuntime.setSettings({
      mode: "blocking",
      blockingTimeout: { enabled: true, durationMs: 0 },
    });
    const tool = createRequestUserInputTool({ store, runtime, requestUserInputRuntime });

    const result = await tool.execute("tool-call-blocking-timeout", {
      questions: [
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          defaultAnswer: "Concise engineering summary focused on user-visible changes.",
        },
      ],
    });

    expect(result.details).toEqual({
      answers: [
        {
          title: "Release note tone",
          question: "What release-note tone should I use?",
          answer: {
            kind: "custom",
            text: "Concise engineering summary focused on user-visible changes.",
          },
          answeredBy: "timeout_default",
        },
      ],
    });
    expect(
      store.getSessionState("session-request-input").requestUserInputRequests[0],
    ).toMatchObject({
      variant: "blocking",
      status: "expired",
      questions: [expect.objectContaining({ status: "defaulted" })],
    });
    expect(store.getSessionState("session-request-input").commands[0]).toMatchObject({
      status: "succeeded",
      facts: expect.objectContaining({
        answeredBy: "timeout_default",
        result: expect.objectContaining({
          answers: [expect.objectContaining({ answeredBy: "timeout_default" })],
        }),
      }),
    });
  });

  it("restores orphaned blocking requests and finalizes them when the user answers", () => {
    const { store } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();
    const request = createDurableBlockingRequest(store, {
      timeout: { enabled: false, durationMs: 300_000 },
    });

    requestUserInputRuntime.restoreOpenBlockingRequests(store);

    expect(store.getSessionState("session-request-input").commands[0]).toMatchObject({
      status: "waiting",
      facts: expect.objectContaining({ answeredBy: "pending" }),
    });
    expect(store.getSessionState("session-request-input").session.wait).toMatchObject({
      kind: "user",
      reason: "CI scope",
    });

    const fullSuite = request.questions[0]!.choices.find(
      (choice) => choice.label === "Full suite",
    )!;
    const answered = store.answerRequestUserInput({
      sessionId: "session-request-input",
      surfacePiSessionId: "session-request-input",
      requestId: request.requestId,
      questionId: request.questions[0]!.questionId,
      answer: { kind: "option", optionId: fullSuite.optionId },
      delivery: "steer",
    });
    expect(answered.queuedMessage).toBeNull();

    const result = requestUserInputRuntime.resolveBlockingRequest(store, request.requestId);

    expect(result).toMatchObject({
      answers: [
        {
          title: "CI scope",
          answer: { kind: "option", label: "Full suite", text: "Full suite" },
          answeredBy: "user",
        },
      ],
    });
    expect(store.getSessionState("session-request-input").commands[0]).toMatchObject({
      status: "succeeded",
      facts: expect.objectContaining({
        answeredBy: "user",
        result: expect.objectContaining({
          answers: [expect.objectContaining({ answeredBy: "user" })],
        }),
      }),
    });
    expect(store.getSessionState("session-request-input").session.wait).toBeNull();
  });

  it("restores orphaned blocking request timers and applies timeout defaults", async () => {
    const { store } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();
    const request = createDurableBlockingRequest(store, {
      timeout: { enabled: true, durationMs: 0 },
    });

    requestUserInputRuntime.restoreOpenBlockingRequests(store);
    await waitFor(
      () =>
        store.getSessionState("session-request-input").requestUserInputRequests[0]?.status ===
        "expired",
    );

    const snapshot = store.getSessionState("session-request-input");
    expect(snapshot.requestUserInputRequests[0]?.answers).toContainEqual(
      expect.objectContaining({
        requestId: request.requestId,
        answeredBy: "timeout_default",
        answer: { kind: "option", label: "Unit checks only", text: "Unit checks only" },
      }),
    );
    expect(snapshot.commands[0]).toMatchObject({
      status: "succeeded",
      facts: expect.objectContaining({
        answeredBy: "timeout_default",
        result: expect.objectContaining({
          answers: [expect.objectContaining({ answeredBy: "timeout_default" })],
        }),
      }),
    });
    expect(snapshot.session.wait).toBeNull();
  });

  it("cancels active blocking requests and rejects the waiting tool call", async () => {
    const { store, runtime } = createHarness();
    const requestUserInputRuntime = new RequestUserInputRuntime();
    requestUserInputRuntime.setSettings({
      mode: "blocking",
      blockingTimeout: { enabled: false, durationMs: 300_000 },
    });
    const tool = createRequestUserInputTool({ store, runtime, requestUserInputRuntime });

    const pending = tool.execute("tool-call-cancel-rui", {
      questions: [
        {
          title: "CI scope",
          question: "Should CI run only unit checks or the full suite before handoff?",
          options: [
            {
              label: "Unit checks only",
              description: "Faster; catches local regressions.",
              recommended: true,
            },
            {
              label: "Full suite",
              description: "Slower; includes e2e behavior.",
            },
          ],
        },
      ],
    });
    await Promise.resolve();

    const request = store.getSessionState("session-request-input").requestUserInputRequests[0]!;
    requestUserInputRuntime.cancelBlockingRequestsForSurface(
      store,
      request.surfacePiSessionId,
      "Prompt cancelled.",
    );

    await expect(pending).rejects.toThrow("Prompt cancelled.");
    const snapshot = store.getSessionState("session-request-input");
    expect(snapshot.requestUserInputRequests[0]).toMatchObject({
      requestId: request.requestId,
      status: "cancelled",
      questions: [expect.objectContaining({ status: "cancelled" })],
    });
    expect(snapshot.commands[0]).toMatchObject({
      status: "cancelled",
      error: "Prompt cancelled.",
    });
    expect(snapshot.session.wait).toBeNull();
  });
});

function createHarness(options: { surfaceKind?: "orchestrator" | "handler" } = {}) {
  const store = createStructuredSessionStateStore({ workspace: WORKSPACE });
  stores.push(store);
  store.upsertPiSession({
    sessionId: "session-request-input",
    title: "Request input",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-08T09:00:00.000Z",
    updatedAt: "2026-06-08T09:00:00.000Z",
  });
  const turn = store.startTurn({
    sessionId: "session-request-input",
    surfacePiSessionId: "session-request-input",
    requestSummary: "Ask a clarification question",
  });
  const rootThread =
    options.surfaceKind === "handler"
      ? store.createThread({
          turnId: turn.id,
          surfacePiSessionId: "pi-thread-request-input",
          title: "Clarify",
          objective: "Ask the user a bounded question.",
        })
      : null;
  const runtime = {
    current: createPromptExecutionContext({
      sessionId: "session-request-input",
      turnId: turn.id,
      surfacePiSessionId: rootThread?.surfacePiSessionId ?? "session-request-input",
      rootThreadId: rootThread?.id ?? null,
      promptText: "Ask a clarification question",
      surfaceKind: options.surfaceKind,
    }),
  };
  return { store, runtime };
}

function createDurableBlockingRequest(
  store: StructuredSessionStateStore,
  input: { timeout: { enabled: boolean; durationMs: number } },
) {
  const snapshot = store.getSessionState("session-request-input");
  const turn = snapshot.turns[0]!;
  const command = store.createCommand({
    turnId: turn.id,
    surfacePiSessionId: "session-request-input",
    threadId: null,
    toolName: "request_user_input",
    executor: "orchestrator",
    visibility: "surface",
    title: "Ask user: CI scope",
    summary: "CI scope",
    facts: {
      questionCount: 1,
      answeredBy: "pending",
    },
  });
  store.startCommand(command.id);
  return store.createRequestUserInputRequest({
    sessionId: "session-request-input",
    surfacePiSessionId: "session-request-input",
    threadId: null,
    turnId: turn.id,
    commandId: command.id,
    toolItemId: "tool-call-recovered-rui",
    variant: "blocking",
    timeout: input.timeout,
    questions: [
      {
        title: "CI scope",
        question: "Should CI run only unit checks or the full suite before handoff?",
        defaultAnswer: {
          kind: "option",
          label: "Unit checks only",
          text: "Unit checks only",
        },
        choices: [
          {
            label: "Unit checks only",
            description: "Faster; catches local regressions.",
            recommended: true,
          },
          {
            label: "Full suite",
            description: "Slower; includes e2e behavior.",
            recommended: false,
          },
        ],
      },
    ],
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for request_user_input condition.");
}
