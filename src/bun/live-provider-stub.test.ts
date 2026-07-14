import { describe, expect, test } from "bun:test";
import {
  createLiveProviderEventGate,
  startLiveProviderStub,
  type CapturedLiveProviderRequest,
  type LiveProviderStub,
} from "../../e2e/live-provider-stub";

const API_KEY = "live-provider-test-key";

type TestLiveProviderStub = LiveProviderStub & {
  sendForTest(prompt: string): Promise<Response>;
};

function promptText(request: CapturedLiveProviderRequest): string | undefined {
  return request.body.messages.findLast((message) => message.role === "user")?.content as
    | string
    | undefined;
}

async function sendPrompt(provider: TestLiveProviderStub, prompt: string): Promise<Response> {
  return provider.sendForTest(prompt);
}

function requestInit(prompt: string): RequestInit {
  return {
    body: JSON.stringify({
      messages: [{ content: prompt, role: "user" }],
      model: "test-model",
      stream: true,
    }),
    headers: {
      authorization: `Bearer ${API_KEY}`,
      "content-type": "application/json",
    },
    method: "POST",
  };
}

function startTestProvider(
  input: Parameters<typeof startLiveProviderStub>[0],
): TestLiveProviderStub {
  let handleRequest: ((request: Request) => Promise<Response> | Response) | undefined;
  const provider = startLiveProviderStub(input, {
    serve: (options) => {
      handleRequest = options.fetch;
      return { port: 31_415, stop: () => undefined };
    },
  });
  if (!handleRequest) throw new Error("Test provider did not receive the request handler.");

  return {
    ...provider,
    baseUrl: "http://live-provider.test/api/coding/paas/v4",
    async sendForTest(prompt: string): Promise<Response> {
      return handleRequest!(
        new Request(
          "http://live-provider.test/api/coding/paas/v4/chat/completions",
          requestInit(prompt),
        ),
      );
    },
  };
}

describe("live provider stub", () => {
  test("semantically matches independent requests out of script order and returns their events", async () => {
    const provider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        {
          events: [{ foreground: "first" }, { foreground: "second" }],
          label: "foreground turn",
          matchesRequest: (request) => promptText(request) === "foreground",
        },
        {
          events: [{ title: "generated" }],
          label: "background title",
          matchesRequest: (request) => promptText(request) === "title",
        },
      ],
    });

    try {
      const receivedBoth = provider.waitForRequestCount(2, 1_000);
      const titleResponse = await sendPrompt(provider, "title");
      const foregroundResponse = await sendPrompt(provider, "foreground");
      await receivedBoth;

      expect(titleResponse.status).toBe(200);
      expect(await titleResponse.text()).toBe('data: {"title":"generated"}\n\ndata: [DONE]\n\n');
      expect(foregroundResponse.status).toBe(200);
      expect(await foregroundResponse.text()).toBe(
        'data: {"foreground":"first"}\n\ndata: {"foreground":"second"}\n\ndata: [DONE]\n\n',
      );
      expect(provider.requests.map((request) => promptText(request))).toEqual([
        "title",
        "foreground",
      ]);
      provider.assertHealthy();
    } finally {
      provider.stop();
    }
  });

  test("rejects ambiguous semantic matches without consuming either step", async () => {
    const provider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        { events: [], label: "first", matchesRequest: () => true },
        { events: [], label: "second", matchesRequest: () => true },
      ],
    });

    try {
      const response = await sendPrompt(provider, "ambiguous");
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({
        error:
          "Ambiguous provider request 1 matched multiple remaining script steps: first, second.",
      });
      expect(() => provider.assertHealthy()).toThrow(
        /Ambiguous provider request 1[\s\S]*Unconsumed provider script steps: first, second\./,
      );
    } finally {
      provider.stop();
    }
  });

  test("distinguishes unmatched requests from duplicate requests", async () => {
    const unmatchedProvider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        {
          events: [],
          label: "foreground",
          matchesRequest: (request) => promptText(request) === "foreground",
        },
      ],
    });

    try {
      const unmatchedResponse = await sendPrompt(unmatchedProvider, "other");
      expect(unmatchedResponse.status).toBe(422);
      expect(await unmatchedResponse.json()).toEqual({
        error: "Unmatched provider request 1; remaining script steps: foreground.",
      });
      expect(() => unmatchedProvider.assertHealthy()).toThrow(
        /Unmatched provider request 1[\s\S]*Unconsumed provider script steps: foreground\./,
      );
    } finally {
      unmatchedProvider.stop();
    }

    const duplicateProvider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        {
          events: [],
          label: "foreground",
          matchesRequest: (request) => promptText(request) === "foreground",
        },
      ],
    });

    try {
      expect((await sendPrompt(duplicateProvider, "foreground")).status).toBe(200);
      const duplicateResponse = await sendPrompt(duplicateProvider, "foreground");
      expect(duplicateResponse.status).toBe(409);
      expect(await duplicateResponse.json()).toEqual({
        error: "Duplicate provider request 2 matched already-consumed script step: foreground.",
      });
      expect(() => duplicateProvider.assertHealthy()).toThrow(/Duplicate provider request 2/);
    } finally {
      duplicateProvider.stop();
    }
  });

  test("records assertion failures after the matching step is consumed", async () => {
    const provider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        {
          assertRequest: () => {
            throw new Error("missing required tool");
          },
          events: [],
          label: "tool turn",
          matchesRequest: () => true,
        },
      ],
    });

    try {
      const response = await sendPrompt(provider, "tool turn");
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: "Provider script step 1 (tool turn) rejected the request: missing required tool",
      });
      expect(() => provider.assertHealthy()).toThrow(/missing required tool/);
      try {
        provider.assertHealthy();
      } catch (error) {
        expect(String(error)).not.toContain("Unconsumed provider script steps");
      }
    } finally {
      provider.stop();
    }
  });

  test("assertHealthy reports every unconsumed step and ordered scripts stay compatible", async () => {
    const provider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        { events: [{ ordered: 1 }], label: "first" },
        { events: [{ ordered: 2 }], label: "second" },
      ],
    });

    try {
      expect((await sendPrompt(provider, "any request")).status).toBe(200);
      expect(() => provider.assertHealthy()).toThrow("Unconsumed provider script steps: second.");
      expect((await sendPrompt(provider, "another request")).status).toBe(200);
      provider.assertHealthy();
    } finally {
      provider.stop();
    }
  });

  test("gates streaming events until the test explicitly releases them", async () => {
    const gate = createLiveProviderEventGate();
    const provider = startTestProvider({
      apiKey: API_KEY,
      steps: [
        {
          events: [{ phase: "before" }, { event: { phase: "after" }, waitFor: gate.wait }],
          label: "controlled stream",
        },
      ],
    });

    try {
      const response = await sendPrompt(provider, "controlled stream");
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toBe('data: {"phase":"before"}\n\n');

      let gatedReadSettled = false;
      const gatedRead = reader.read().then((result) => {
        gatedReadSettled = true;
        return result;
      });
      await Promise.resolve();
      expect(gatedReadSettled).toBe(false);

      gate.release();
      expect(decoder.decode((await gatedRead).value)).toBe('data: {"phase":"after"}\n\n');
      expect(decoder.decode((await reader.read()).value)).toBe("data: [DONE]\n\n");
      expect((await reader.read()).done).toBe(true);
      provider.assertHealthy();
    } finally {
      gate.release();
      provider.stop();
    }
  });

  test("rejects scripts that mix ordered and semantic steps", () => {
    expect(() =>
      startLiveProviderStub({
        apiKey: API_KEY,
        steps: [
          { events: [], label: "ordered" },
          { events: [], label: "semantic", matchesRequest: () => true },
        ],
      }),
    ).toThrow(
      "Live provider scripts cannot mix ordered steps with semantic steps; add matchesRequest to every step.",
    );
  });
});
