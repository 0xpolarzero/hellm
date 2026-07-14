export type LiveChatCompletionRequest = {
  model: string;
  messages: Array<Record<string, unknown>>;
  stream: true;
  tools?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

export type CapturedLiveProviderRequest = {
  body: LiveChatCompletionRequest;
  headers: Record<string, string>;
  method: string;
  path: string;
  receivedAt: string;
};

export type LiveProviderScriptStep = {
  label: string;
  assertRequest?: (request: CapturedLiveProviderRequest) => void;
  events: readonly LiveProviderScriptEvent[];
  matchesRequest?: (request: CapturedLiveProviderRequest) => boolean;
};

export type LiveProviderEventGate = {
  release(): void;
  wait(): Promise<void>;
};

export type LiveProviderScriptEvent =
  | Record<string, unknown>
  | {
      event: Record<string, unknown>;
      waitFor: () => Promise<void>;
    };

export type LiveProviderStub = {
  baseUrl: string;
  requests: readonly CapturedLiveProviderRequest[];
  assertHealthy(): void;
  stop(): void;
  waitForRequestCount(count: number, timeoutMs?: number): Promise<void>;
};

type RequestWaiter = {
  count: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type RemainingScriptStep = {
  index: number;
  step: LiveProviderScriptStep;
};

type LiveProviderServer = {
  port: number;
  stop(closeActiveConnections?: boolean): void;
};

type LiveProviderServe = (input: {
  fetch(request: Request): Promise<Response> | Response;
  hostname: string;
  port: number;
}) => LiveProviderServer;

const CHAT_COMPLETIONS_PATH = "/api/coding/paas/v4/chat/completions";

export function createLiveProviderEventGate(): LiveProviderEventGate {
  let released = false;
  let releaseWaiter: (() => void) | null = null;
  const releasedPromise = new Promise<void>((resolve) => {
    releaseWaiter = resolve;
  });

  return {
    release(): void {
      if (released) return;
      released = true;
      releaseWaiter?.();
      releaseWaiter = null;
    },
    wait(): Promise<void> {
      return releasedPromise;
    },
  };
}

export function startLiveProviderStub(
  input: {
    apiKey: string;
    steps: readonly LiveProviderScriptStep[];
  },
  dependencies: {
    serve?: LiveProviderServe;
  } = {},
): LiveProviderStub {
  const semanticStepCount = input.steps.filter((step) => step.matchesRequest !== undefined).length;
  if (semanticStepCount > 0 && semanticStepCount !== input.steps.length) {
    throw new Error(
      "Live provider scripts cannot mix ordered steps with semantic steps; add matchesRequest to every step.",
    );
  }

  const requests: CapturedLiveProviderRequest[] = [];
  const violations: string[] = [];
  const remainingSteps: RemainingScriptStep[] = input.steps.map((step, index) => ({ index, step }));
  const consumedSteps: RemainingScriptStep[] = [];
  const waiters = new Set<RequestWaiter>();
  let stopped = false;

  const settleWaiters = (): void => {
    for (const waiter of waiters) {
      if (requests.length < waiter.count) continue;
      clearTimeout(waiter.timeout);
      waiters.delete(waiter);
      waiter.resolve();
    }
  };

  const server = (dependencies.serve ?? ((options) => Bun.serve(options)))({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const requestNumber = requests.length + 1;

      if (request.method !== "POST" || url.pathname !== CHAT_COMPLETIONS_PATH) {
        const violation = `Unexpected provider request ${request.method} ${url.pathname}.`;
        violations.push(violation);
        return Response.json({ error: violation }, { status: 404 });
      }

      if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        const violation = `Provider request ${requestNumber} did not use application/json.`;
        violations.push(violation);
        return Response.json({ error: violation }, { status: 415 });
      }

      if (request.headers.get("authorization") !== `Bearer ${input.apiKey}`) {
        const violation = `Provider request ${requestNumber} used unexpected authorization.`;
        violations.push(violation);
        return Response.json({ error: violation }, { status: 401 });
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch (error) {
        const violation = `Provider request ${requestNumber} was not valid JSON: ${
          error instanceof Error ? error.message : String(error)
        }`;
        violations.push(violation);
        return Response.json({ error: violation }, { status: 400 });
      }

      if (!isLiveChatCompletionRequest(body)) {
        const violation = `Provider request ${requestNumber} did not match the streaming chat-completions contract.`;
        violations.push(violation);
        return Response.json({ error: violation }, { status: 422 });
      }

      const captured: CapturedLiveProviderRequest = {
        body,
        headers: Object.fromEntries(request.headers.entries()),
        method: request.method,
        path: url.pathname,
        receivedAt: new Date().toISOString(),
      };
      requests.push(captured);
      settleWaiters();

      const selected: RemainingScriptStep | { status: number; violation: string } =
        semanticStepCount === 0
          ? (remainingSteps[0] ?? {
              status: 409,
              violation: `Unexpected provider request ${requestNumber}; the script has only ${input.steps.length} steps.`,
            })
          : selectSemanticStep({ captured, consumedSteps, remainingSteps, requestNumber });

      if ("violation" in selected) {
        violations.push(selected.violation);
        return Response.json({ error: selected.violation }, { status: selected.status });
      }

      const remainingIndex = remainingSteps.findIndex(
        (candidate) => candidate.index === selected.index,
      );
      remainingSteps.splice(remainingIndex, 1);
      consumedSteps.push(selected);

      try {
        selected.step.assertRequest?.(captured);
      } catch (error) {
        const violation = `Provider script step ${requestNumber} (${selected.step.label}) rejected the request: ${
          error instanceof Error ? error.message : String(error)
        }`;
        violations.push(violation);
        return Response.json({ error: violation }, { status: 422 });
      }

      return sseResponse(selected.step.events);
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}/api/coding/paas/v4`,
    requests,
    assertHealthy(): void {
      const problems = [...violations];
      if (remainingSteps.length > 0) {
        problems.push(
          `Unconsumed provider script steps: ${remainingSteps
            .map(({ step }) => step.label)
            .join(", ")}.`,
        );
      }
      if (problems.length > 0) {
        throw new Error(`Live provider stub violations:\n${problems.join("\n")}`);
      }
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error("Live provider stub stopped before the expected request arrived."));
      }
      waiters.clear();
      server.stop(true);
    },
    async waitForRequestCount(count: number, timeoutMs = 20_000): Promise<void> {
      if (!Number.isSafeInteger(count) || count < 1) {
        throw new Error("Provider request count must be a positive safe integer.");
      }
      if (requests.length >= count) return;
      if (stopped) {
        throw new Error("Live provider stub is already stopped.");
      }

      await new Promise<void>((resolve, reject) => {
        const waiter: RequestWaiter = {
          count,
          resolve,
          reject,
          timeout: setTimeout(() => {
            waiters.delete(waiter);
            reject(
              new Error(
                `Timed out waiting for provider request ${count}; received ${requests.length}.`,
              ),
            );
          }, timeoutMs),
        };
        waiters.add(waiter);
      });
    },
  };
}

function selectSemanticStep(input: {
  captured: CapturedLiveProviderRequest;
  consumedSteps: readonly RemainingScriptStep[];
  remainingSteps: readonly RemainingScriptStep[];
  requestNumber: number;
}): RemainingScriptStep | { status: number; violation: string } {
  const matches: RemainingScriptStep[] = [];
  for (const candidate of input.remainingSteps) {
    try {
      if (candidate.step.matchesRequest?.(input.captured)) matches.push(candidate);
    } catch (error) {
      return {
        status: 422,
        violation: `Provider script matcher (${candidate.step.label}) threw for request ${input.requestNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (matches.length === 1) return matches[0]!;

  if (matches.length > 1) {
    return {
      status: 409,
      violation: `Ambiguous provider request ${input.requestNumber} matched multiple remaining script steps: ${matches
        .map(({ step }) => step.label)
        .join(", ")}.`,
    };
  }

  const duplicateMatches: RemainingScriptStep[] = [];
  for (const candidate of input.consumedSteps) {
    try {
      if (candidate.step.matchesRequest?.(input.captured)) duplicateMatches.push(candidate);
    } catch (error) {
      return {
        status: 422,
        violation: `Provider script matcher (${candidate.step.label}) threw for request ${input.requestNumber}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (duplicateMatches.length > 0) {
    return {
      status: 409,
      violation: `Duplicate provider request ${input.requestNumber} matched already-consumed script ${
        duplicateMatches.length === 1 ? "step" : "steps"
      }: ${duplicateMatches.map(({ step }) => step.label).join(", ")}.`,
    };
  }

  return {
    status: 422,
    violation: `Unmatched provider request ${input.requestNumber}; remaining script steps: ${
      input.remainingSteps.length > 0
        ? input.remainingSteps.map(({ step }) => step.label).join(", ")
        : "none"
    }.`,
  };
}

export function chatCompletionChunk(input: {
  choices: readonly Record<string, unknown>[];
  id: string;
  model: string;
}): Record<string, unknown> {
  return {
    id: input.id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: input.choices,
  };
}

function isLiveChatCompletionRequest(value: unknown): value is LiveChatCompletionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.model === "string" &&
    request.model.length > 0 &&
    Array.isArray(request.messages) &&
    request.messages.every(
      (message) => Boolean(message) && typeof message === "object" && !Array.isArray(message),
    ) &&
    request.stream === true &&
    (request.tools === undefined || Array.isArray(request.tools))
  );
}

function sseResponse(events: readonly LiveProviderScriptEvent[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const scriptedEvent of events) {
          const event = isGatedProviderEvent(scriptedEvent)
            ? (await scriptedEvent.waitFor(), scriptedEvent.event)
            : scriptedEvent;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(body, {
    headers: {
      "cache-control": "no-cache",
      connection: "keep-alive",
      "content-type": "text/event-stream",
    },
  });
}

function isGatedProviderEvent(
  event: LiveProviderScriptEvent,
): event is Extract<LiveProviderScriptEvent, { waitFor: () => Promise<void> }> {
  return (
    "event" in event &&
    Boolean(event.event) &&
    typeof event.event === "object" &&
    !Array.isArray(event.event) &&
    "waitFor" in event &&
    typeof event.waitFor === "function"
  );
}
