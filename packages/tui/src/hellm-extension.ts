import { basename } from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AgentSessionRuntime,
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  createContextLoader,
  createOrchestrator,
  type OrchestratorDependencies,
  type OrchestratorRequest,
  type OrchestratorRunResult,
} from "@hellm/orchestrator";
import {
  createPromptingPiRuntimeBridge,
  type PiWorkerRequest,
} from "@hellm/pi-bridge";
import {
  createSessionHeader,
  parseStructuredSessionEntry,
  reconstructSessionState,
  type SessionJsonlEntry,
  type SessionState,
} from "@hellm/session-model";
import { projectSessionState, renderMultiThreadProjection } from "./projection.ts";

interface RuntimeRef {
  current?: AgentSessionRuntime;
}

export interface HellmExtensionOptions {
  runtimeRef: RuntimeRef;
  orchestratorOverrides?: Pick<
    OrchestratorDependencies,
    | "classifier"
    | "clock"
    | "idGenerator"
    | "piBridge"
    | "smithersBridge"
    | "verificationRunner"
  >;
}

interface PiWorkerExecution {
  status: "completed" | "blocked" | "waiting_input" | "failed";
  outputSummary?: string;
  conclusions?: string[];
  unresolvedIssues?: string[];
}

function getRuntime(options: HellmExtensionOptions): AgentSessionRuntime {
  const runtime = options.runtimeRef.current;
  if (!runtime) {
    throw new Error("hellm interactive runtime is unavailable.");
  }
  return runtime;
}

function getPiSessionEntries(runtime: AgentSessionRuntime): SessionJsonlEntry[] {
  const sessionManager = runtime.session.sessionManager;
  return [
    createSessionHeader({
      id: sessionManager.getSessionId(),
      timestamp: new Date().toISOString(),
      cwd: runtime.cwd,
    }),
    ...(sessionManager.getEntries() as unknown as SessionJsonlEntry[]),
  ];
}

function readSessionState(options: HellmExtensionOptions): SessionState {
  return reconstructSessionState(getPiSessionEntries(getRuntime(options)));
}

function activeProjectionLines(
  state: SessionState,
  activeThreadId?: string,
): string[] {
  return renderMultiThreadProjection(projectSessionState(state, activeThreadId));
}

function summarizeThreadStatus(state: SessionState, activeThreadId?: string): string | undefined {
  const activeThread = activeThreadId
    ? state.threads.find((thread) => thread.id === activeThreadId)
    : state.threads.at(-1);
  if (!activeThread) {
    return undefined;
  }

  return `${activeThread.kind}:${activeThread.status}`;
}

function getSessionInstructions(options: HellmExtensionOptions): string[] {
  const runtime = getRuntime(options);
  return runtime.services.resourceLoader.getAgentsFiles().agentsFiles.map(
    (file) => file.content,
  );
}

function getRelevantSkills(options: HellmExtensionOptions): string[] {
  const runtime = getRuntime(options);
  return runtime.services.resourceLoader.getSkills().skills.map((skill) => skill.name);
}

function getAssistantText(message: AgentMessage | undefined): string {
  if (!message || message.role !== "assistant" || !Array.isArray(message.content)) {
    return "";
  }

  return message.content
    .filter((block): block is { type: "text"; text: string } =>
      block.type === "text" && typeof block.text === "string"
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toConclusionLines(summary: string): string[] {
  if (!summary.trim()) {
    return [];
  }

  return summary
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

async function runPromptThroughCurrentSession(
  runtime: AgentSessionRuntime,
  request: PiWorkerRequest,
): Promise<PiWorkerExecution> {
  const session = runtime.session;
  await session.agent.waitForIdle();

  const beforeCount = session.agent.state.messages.length;
  await session.prompt(request.objective, {
    source: "extension",
  });
  await session.agent.waitForIdle();

  const newMessages = session.agent.state.messages.slice(beforeCount);
  const lastAssistant = newMessages
    .toReversed()
    .find((message) => message.role === "assistant");
  const summary = getAssistantText(lastAssistant);

  if (!lastAssistant) {
    return {
      status: "failed",
      conclusions: ["Pi session did not produce an assistant response."],
      unresolvedIssues: [
        "The embedded pi runtime finished without appending an assistant message.",
      ],
    };
  }

  return {
    status: "completed",
    outputSummary: summary,
    conclusions: toConclusionLines(summary),
  };
}

function persistRunResult(pi: ExtensionAPI, result: OrchestratorRunResult): void {
  for (const entry of result.sessionEntries) {
    const payload = parseStructuredSessionEntry(entry);
    if (!payload) {
      continue;
    }

    pi.appendEntry(`hellm/${payload.kind}`, payload.data);
  }
}

function updateUi(
  ctx: ExtensionContext,
  options: HellmExtensionOptions,
  activeThreadId?: string,
): SessionState {
  const state = readSessionState(options);
  if (ctx.hasUI) {
    ctx.ui.setWidget("hellm-state", activeProjectionLines(state, activeThreadId), {
      placement: "belowEditor",
    });
    ctx.ui.setTitle(`hellm • ${basename(ctx.cwd)}`);
    ctx.ui.setStatus("hellm-state", summarizeThreadStatus(state, activeThreadId));
  }
  return state;
}

function createEmbeddedOrchestrator(options: HellmExtensionOptions) {
  const runtime = getRuntime(options);
  const embeddedPiBridge =
    options.orchestratorOverrides?.piBridge ??
    createPromptingPiRuntimeBridge({
      runWorker: async (request) => runPromptThroughCurrentSession(runtime, request),
    });

  return createOrchestrator({
    contextLoader: createContextLoader({
      loadSessionHistory: async () => getPiSessionEntries(runtime),
      loadRepoAndWorktree: async () => ({
        cwd: runtime.cwd,
      }),
      loadAgentsInstructions: async () => getSessionInstructions(options),
      loadRelevantSkills: async () => getRelevantSkills(options),
      loadState: async () => readSessionState(options),
    }),
    piBridge: embeddedPiBridge,
    ...options.orchestratorOverrides,
  });
}

function threadIdForRequest(state: SessionState, activeThreadId?: string): string {
  if (activeThreadId) {
    const activeThread = state.threads.find((thread) => thread.id === activeThreadId);
    if (
      activeThread &&
      (activeThread.status === "waiting_input" ||
        activeThread.status === "waiting_approval" ||
        activeThread.status === "running")
    ) {
      return activeThread.id;
    }
  }

  return `thread-${Date.now()}`;
}

async function executeOrchestratorRequest(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: HellmExtensionOptions,
  input: Omit<OrchestratorRequest, "cwd">,
): Promise<OrchestratorRunResult> {
  const runtime = getRuntime(options);
  const orchestrator = createEmbeddedOrchestrator(options);
  const result = await orchestrator.run({
    ...input,
    cwd: runtime.cwd,
  });
  persistRunResult(pi, result);
  updateUi(ctx, options, result.threadSnapshot.thread.id);
  if (ctx.hasUI) {
    ctx.ui.notify(
      `${result.classification.path}: ${result.threadSnapshot.thread.status}`,
      result.completion.isComplete ? "info" : "warning",
    );
  }
  return result;
}

function formatThreadsList(state: SessionState): string {
  if (state.threads.length === 0) {
    return "No threads recorded.";
  }

  return state.threads
    .map((thread) => `${thread.id} [${thread.kind}] ${thread.status}`)
    .join("\n");
}

function resolveActiveThreadId(
  state: SessionState,
  preferredThreadId: string | undefined,
): string | undefined {
  if (preferredThreadId && state.threads.some((thread) => thread.id === preferredThreadId)) {
    return preferredThreadId;
  }

  return state.threads.at(-1)?.id;
}

export function createHellmExtension(
  options: HellmExtensionOptions,
): (pi: ExtensionAPI) => void {
  return function hellmExtension(pi: ExtensionAPI): void {
    let activeThreadId: string | undefined;

    pi.on("session_start", async (_event, ctx) => {
      const state = updateUi(ctx, options, activeThreadId);
      activeThreadId = resolveActiveThreadId(state, activeThreadId);
      updateUi(ctx, options, activeThreadId);
    });

    pi.registerCommand("threads", {
      description: "List hellm threads or activate one by id",
      handler: async (args, ctx) => {
        const state = updateUi(ctx, options, activeThreadId);
        const requestedId = args.trim();
        if (!requestedId) {
          ctx.ui.notify(formatThreadsList(state), "info");
          return;
        }

        const thread = state.threads.find((candidate) => candidate.id === requestedId);
        if (!thread) {
          ctx.ui.notify(`Unknown thread: ${requestedId}`, "error");
          return;
        }

        activeThreadId = thread.id;
        updateUi(ctx, options, activeThreadId);
        ctx.ui.notify(`Active thread: ${thread.id}`, "info");
      },
    });

    pi.registerCommand("reconcile", {
      description: "Run the orchestrator against the active thread objective",
      handler: async (args, ctx) => {
        const state = updateUi(ctx, options, activeThreadId);
        activeThreadId = resolveActiveThreadId(state, activeThreadId);
        const prompt =
          args.trim() ||
          state.threads.find((thread) => thread.id === activeThreadId)?.objective ||
          "Reconcile current workspace state.";
        const result = await executeOrchestratorRequest(pi, ctx, options, {
          threadId: activeThreadId ?? `thread-${Date.now()}`,
          prompt,
        });
        activeThreadId = result.threadSnapshot.thread.id;
      },
    });

    pi.registerCommand("verify", {
      description: "Run verification for the active thread objective",
      handler: async (args, ctx) => {
        const state = updateUi(ctx, options, activeThreadId);
        activeThreadId = resolveActiveThreadId(state, activeThreadId);
        const prompt =
          args.trim() ||
          state.threads.find((thread) => thread.id === activeThreadId)?.objective ||
          "Verify the current workspace state.";
        const result = await executeOrchestratorRequest(pi, ctx, options, {
          threadId: activeThreadId ?? `thread-${Date.now()}`,
          prompt,
          routeHint: "verification",
        });
        activeThreadId = result.threadSnapshot.thread.id;
      },
    });

    pi.on("input", async (event, ctx) => {
      if (event.source !== "interactive") {
        return;
      }

      const trimmed = event.text.trim();
      if (
        trimmed.length === 0 ||
        trimmed.startsWith("/") ||
        trimmed.startsWith("!")
      ) {
        return;
      }

      if (event.images && event.images.length > 0) {
        return;
      }

      const state = updateUi(ctx, options, activeThreadId);
      const result = await executeOrchestratorRequest(pi, ctx, options, {
        threadId: threadIdForRequest(state, activeThreadId),
        prompt: event.text,
      });
      activeThreadId = result.threadSnapshot.thread.id;
      return {
        action: "handled",
      };
    });
  };
}
