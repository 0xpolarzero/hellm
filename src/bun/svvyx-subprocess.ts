import { createHmac, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { AgentSettingsState } from "../shared/agent-settings";
import { DEFAULT_AGENT_SETTINGS_STATE } from "../shared/agent-settings";
import type { AppLoggerEvent } from "./app-logger";
import type { AgentSettingsStore } from "./agent-settings-store";
import { createMacOsKeychainExtensionEnvSecretStore } from "./extension-env-secret-store";
import {
  formatSvvyxArtifactsError,
  parseSvvyxArtifactsCommand,
  type SvvyxArtifactsOperationInput,
  type SvvyxArtifactsRuntimeContext,
} from "./svvyx-artifacts-command";
import { formatSvvyxExtensionsError, runSvvyxExtensionsCommand } from "./svvyx-extensions-command";
import {
  formatSvvyxRuntimeError,
  runSvvyxRuntimeCommand,
  type SvvyxRuntimeEnvValues,
} from "./svvyx-runtime-command";
import {
  formatSvvyxWorkflowsError,
  runSvvyxWorkflowsCommand,
  type SvvyxWorkflowsModelChoice,
} from "./svvyx-workflows-command";
import type {
  PromptExecutionExternalInstructionSource,
  RuntimeExtensionContextImpactStateFacade,
  SvvyxRuntimeEffectTransportIntent,
} from "@svvy/core";

type SvvyxSubprocessContext = {
  agentSettingsState?: AgentSettingsState | null;
  canRequestArtifactOpen?: boolean;
  cwd: string;
  extensionEnvValues?: SvvyxRuntimeEnvValues | null;
  extensionsBuildRoot?: string;
  extensionsGeneratedPackagePath?: string;
  extensionsRoot?: string;
  externalInstructionSources?: readonly PromptExecutionExternalInstructionSource[];
  resultPath?: string;
  runtime?: SvvyxArtifactsRuntimeContext | null;
  sourceCommandId?: string | null;
  workflowModelCatalog?: readonly SvvyxWorkflowsModelChoice[] | null;
  workflowsGeneratedPackagePath?: string;
  workflowsSourceRoot?: string;
  workspaceCwd?: string;
};

type SvvyxSubprocessResult = {
  agentSettingsState?: AgentSettingsState;
  appActions: SvvyxSubprocessAppAction[];
  appLogEvents: AppLoggerEvent[];
  commandFacts?: Record<string, unknown>;
  intents?: SvvyxSubprocessIntent[];
  ok: boolean;
  output?: unknown;
  progressEvents?: SvvyxSubprocessProgressEvent[];
};

type SvvyxSubprocessAppAction = {
  kind: "artifact.open";
  artifactId: string;
  sessionId: string;
};

type SvvyxSubprocessIntent =
  | {
      id: string;
      kind: "artifact.operation";
      operation: SvvyxArtifactsOperationInput;
    }
  | SvvyxRuntimeEffectTransportIntent;

type SvvyxSubprocessProgressEvent = {
  facts?: Record<string, unknown>;
  family: string;
  phase: "failed" | "started" | "succeeded";
};

async function main(): Promise<number> {
  const context = readContext();
  const argv = Bun.argv.slice(2);
  const command = ["svvyx", ...argv].map(shellQuote).join(" ");
  const appActions: SvvyxSubprocessAppAction[] = [];
  const appLogEvents: AppLoggerEvent[] = [];
  const intents: SvvyxSubprocessIntent[] = [];
  const progressEvents: SvvyxSubprocessProgressEvent[] = [];
  const agentSettingsStore = createSnapshotAgentSettingsStore(context.agentSettingsState);
  const envSecretStore = createMacOsKeychainExtensionEnvSecretStore();
  const extensionContextImpactState = createTransportRuntimeEffectRequestState(intents);

  const recordProgress = (
    phase: "failed" | "started" | "succeeded",
    facts?: Record<string, unknown> | null,
  ) => {
    progressEvents.push({
      family: commandFamily(argv),
      phase,
      ...(facts ? { facts } : {}),
    });
  };

  try {
    recordProgress("started");
    const namespace = argv[0];
    let output: unknown;
    let commandFacts: Record<string, unknown> | undefined;

    if (namespace === "artifacts") {
      if (!context.runtime || !context.sourceCommandId) {
        throw new Error("Artifacts commands require active prompt command context.");
      }
      const operation = parseSvvyxArtifactsCommand(command);
      intents.push({
        id: "artifact.operation",
        kind: "artifact.operation",
        operation,
      });
      output = { ok: true };
    } else if (namespace === "workflows") {
      const result = await runSvvyxWorkflowsCommand({
        agentSettingsStore,
        command,
        cwd: context.cwd,
        envSecretStore,
        extensionsBuildRoot: context.extensionsBuildRoot,
        extensionsRoot: context.extensionsRoot,
        extensionsGeneratedPackagePath: context.extensionsGeneratedPackagePath,
        generatedPackagePath: context.workflowsGeneratedPackagePath,
        readModelCatalog: context.workflowModelCatalog
          ? () => [...context.workflowModelCatalog!]
          : undefined,
        sourceRoot: context.workflowsSourceRoot,
        workspaceCwd: context.workspaceCwd,
      });
      output = result.output;
      commandFacts = result.commandFacts;
      if (commandFacts.workflowBuildOk === true) {
        appLogEvents.push({
          level: "info",
          source: "workflow.library",
          message: "Workflows build validation passed.",
          details: workflowLogDetails(command, context, pickWorkflowLogFacts(commandFacts)),
        });
      }
    } else if (namespace === "extensions") {
      const result = await runSvvyxExtensionsCommand({
        agentSettingsStore,
        buildRoot: context.extensionsBuildRoot,
        command,
        cwd: context.cwd,
        envSecretStore,
        extensionContextImpactState,
        externalInstructionSources: context.externalInstructionSources ?? [],
        extensionsRoot: context.extensionsRoot,
      });
      output = result.output;
      commandFacts = result.commandFacts;
    } else {
      const result = await runSvvyxRuntimeCommand({
        command,
        envSecretStore,
        envValues: context.extensionEnvValues ?? undefined,
        extensionsRoot: context.extensionsRoot,
      });
      output = result.output;
      commandFacts = result.commandFacts;
    }

    recordProgress("succeeded", commandFacts);
    writeStdoutJson(output);
    writeResult(
      context,
      {
        ...(agentSettingsStore.dirty()
          ? { agentSettingsState: agentSettingsStore.getState() }
          : {}),
        appActions,
        appLogEvents,
        ...(commandFacts ? { commandFacts } : {}),
        ...(intents.length > 0 ? { intents } : {}),
        ok: true,
        output,
        progressEvents,
      },
      namespace,
    );
    return 0;
  } catch (error) {
    const output = formatError(argv[0], error);
    const commandFacts = commandErrorFacts(argv, output);
    if (argv[0] === "workflows") {
      appLogEvents.push({
        level: "warning",
        source: "workflow.library",
        message: "Workflows build validation failed.",
        details: workflowLogDetails(command, context, {
          errorCode: output.error.code,
          errorMessage: output.error.message,
          ...(Array.isArray(output.error.diagnostics)
            ? { workflowDiagnosticCount: output.error.diagnostics.length }
            : {}),
        }),
      });
    }
    recordProgress("failed", commandFacts);
    writeStderrJson({ ...output, ...(commandFacts ? { commandFacts } : {}) });
    writeResult(
      context,
      {
        ...(agentSettingsStore.dirty()
          ? { agentSettingsState: agentSettingsStore.getState() }
          : {}),
        appActions,
        appLogEvents,
        ...(commandFacts ? { commandFacts } : {}),
        ok: false,
        progressEvents,
      },
      argv[0],
    );
    return 1;
  }
}

function readContext(): SvvyxSubprocessContext {
  const raw = process.env.SVVY_SVVYX_SUBPROCESS_CONTEXT;
  if (!raw) {
    return {
      cwd: process.cwd(),
    };
  }
  const parsed = JSON.parse(raw) as SvvyxSubprocessContext;
  return {
    ...parsed,
    cwd: parsed.cwd || process.cwd(),
  };
}

function createSnapshotAgentSettingsStore(
  initialState: AgentSettingsState | null | undefined,
): AgentSettingsStore & { dirty(): boolean } {
  let state = structuredClone(initialState ?? DEFAULT_AGENT_SETTINGS_STATE);
  let dirty = false;
  const setState = (next: AgentSettingsState) => {
    dirty = true;
    state = structuredClone(next);
    return state;
  };
  return {
    dirty: () => dirty,
    getState: () => structuredClone(state),
    setAgentProfile: (profile) =>
      setState({
        ...state,
        agents: {
          ...state.agents,
          orchestrators: state.agents.orchestrators.map((candidate) =>
            candidate.id === profile.id ? profile : candidate,
          ),
        },
      }),
    deleteAgentProfile: (id) =>
      setState({
        ...state,
        agents: {
          ...state.agents,
          orchestrators: state.agents.orchestrators.filter((profile) => profile.id !== id),
        },
      }),
    reorderOrchestratorProfiles: (ids) =>
      setState({
        ...state,
        agents: {
          ...state.agents,
          orchestrators: ids
            .map((id) => state.agents.orchestrators.find((profile) => profile.id === id))
            .filter((profile): profile is (typeof state.agents.orchestrators)[number] => !!profile),
        },
      }),
    setWorkflowAgent: (key, settings) =>
      setState({ ...state, workflowAgents: { ...state.workflowAgents, [key]: settings } }),
    deleteWorkflowAgent: (key) => {
      const workflowAgents = { ...(state.workflowAgents as Record<string, unknown>) };
      delete workflowAgents[key];
      return setState({
        ...state,
        workflowAgents: workflowAgents as AgentSettingsState["workflowAgents"],
      });
    },
    setExtensionDefaults: (extensionDefaults) => setState({ ...state, extensionDefaults }),
    setExtensionEnv: (extensionEnv) => setState({ ...state, extensionEnv }),
    setRequestUserInput: (requestUserInput) => setState({ ...state, requestUserInput }),
    setAppPreferences: (appPreferences) => setState({ ...state, appPreferences }),
  };
}

function commandFamily(argv: readonly string[]): string {
  const namespace = argv[0];
  if (namespace === "artifacts" || namespace === "extensions" || namespace === "workflows") {
    return namespace;
  }
  return "runtime";
}

function formatError(
  namespace: string | undefined,
  error: unknown,
): {
  error: {
    code: string;
    diagnostics?: unknown[];
    message: string;
  } & Record<string, unknown>;
} {
  if (namespace === "artifacts") {
    return formatSvvyxArtifactsError(error);
  }
  if (namespace === "workflows") {
    return formatSvvyxWorkflowsError(error);
  }
  if (namespace === "extensions") {
    return formatSvvyxExtensionsError(error);
  }
  return formatSvvyxRuntimeError(error);
}

function createTransportRuntimeEffectRequestState(
  intents: SvvyxSubprocessIntent[],
): RuntimeExtensionContextImpactStateFacade {
  return {
    listUsageContextAffectedSurfaces: (input) => {
      intents.push({
        id: `runtime-effect-${intents.length + 1}`,
        kind: "runtime_effect.request",
        request: {
          type: "extension_usage.context_impact",
          input,
          target: "extension_usage",
        },
      });
      return [];
    },
    applySnapshotContextImpact: (input) => {
      intents.push({
        id: `runtime-effect-${intents.length + 1}`,
        kind: "runtime_effect.request",
        request: {
          type: "extension_snapshot.context_impact",
          input,
          target: "snapshot_load",
        },
      });
      return [];
    },
  };
}

function commandErrorFacts(
  argv: readonly string[],
  output: ReturnType<typeof formatError>,
): Record<string, unknown> | undefined {
  const namespace = argv[0];
  if (namespace === "workflows") {
    return {
      svvyxDispatch: true,
      extensionId: "workflows",
      extensionArgv: argv.slice(1),
      ...(argv[1] ? { workflowCommand: argv[1] } : {}),
      workflowBuildOk: false,
      errorCode: output.error.code,
      ...(Array.isArray(output.error.diagnostics)
        ? { workflowDiagnosticCount: output.error.diagnostics.length }
        : {}),
    };
  }
  const formatted = output as { commandFacts?: Record<string, unknown> };
  return formatted.commandFacts;
}

function pickWorkflowLogFacts(facts: Record<string, unknown>): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  for (const key of [
    "workflowBuildOk",
    "workflowDiagnosticCount",
    "workflowExportCount",
    "workflowSavedExportName",
    "workflowSavedKind",
    "workflowSourcePath",
  ]) {
    const value = facts[key];
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
      details[key] = value;
    }
  }
  return details;
}

function workflowLogDetails(
  command: string,
  context: SvvyxSubprocessContext,
  facts: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(context.runtime
      ? {
          workspaceSessionId: context.runtime.sessionId,
          surfacePiSessionId: context.runtime.surfacePiSessionId,
          ...(context.runtime.surfaceThreadId ? { threadId: context.runtime.surfaceThreadId } : {}),
        }
      : {}),
    ...(context.sourceCommandId ? { commandId: context.sourceCommandId } : {}),
    command,
    ...facts,
  };
}

function writeResult(
  context: SvvyxSubprocessContext,
  result: SvvyxSubprocessResult,
  extensionId: string | undefined,
): void {
  if (!context.resultPath) {
    return;
  }
  const resultKey = process.env.SVVY_SVVYX_SUBPROCESS_RESULT_KEY;
  if (!resultKey || !context.sourceCommandId) {
    return;
  }
  const payload = {
    status: result.ok ? "succeeded" : "failed",
    ...(result.output !== undefined ? { output: result.output } : {}),
    ...(result.commandFacts ? { commandFacts: result.commandFacts } : {}),
    ...(result.intents ? { intents: result.intents } : {}),
    ...(result.progressEvents ? { progressEvents: result.progressEvents } : {}),
    diagnostics: result.ok ? [] : ["svvyx subprocess command failed"],
    appActions: result.appActions,
    appLogEvents: result.appLogEvents,
    ...(result.agentSettingsState ? { agentSettingsState: result.agentSettingsState } : {}),
  };
  const unsignedEnvelope = {
    envelopeVersion: 1,
    invocationId: randomUUID(),
    commandId: context.sourceCommandId,
    extensionId: extensionId ?? "svvyx",
    createdAt: new Date().toISOString(),
    payload,
  };
  const digest = createHmac("sha256", resultKey)
    .update(JSON.stringify(unsignedEnvelope))
    .digest("base64url");
  const signed = {
    ...unsignedEnvelope,
    signature: {
      algorithm: "hmac-sha256",
      keyId: "svvyx-subprocess-result",
      digest,
    },
  };
  writeFileSync(context.resultPath, `${JSON.stringify(signed, null, 2)}\n`);
}

function writeStdoutJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2));
}

function writeStderrJson(value: unknown): void {
  process.stderr.write(`${JSON.stringify(value)}\n`);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const exitCode = await main();
process.exit(exitCode);
