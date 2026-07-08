import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import * as Effect from "effect/Effect";
import {
  createListExtensionsTool,
  createLoadExtensionTool as createLoadExtensionToolBase,
  type RunAcceptedLoadExtension,
} from "./extension-tools";
import { resolveExtensionRecord } from "./svvyx-extensions-command";
import { builtinLoadedInstructionDefaults } from "./default-system-prompt";
import type { PromptExecutionRuntimeHandle } from "@svvy/runtime/prompt-execution-context";
import type { ListExtensionsDetails } from "@svvy/extensions";

/**
 * Unwrap a `extFacts(NativeToolResult).commandFacts` payload back into the typed
 * list/load extension details shape for assertion. The runtime wraps the result
 * as `details.commandFacts` (a `CommandFactsPayload` JSON record); tests read
 * the typed fields through this cast.
 */
function extFacts(result: {
  readonly details?: { readonly commandFacts?: unknown } | undefined;
}): ListExtensionsDetails & { readonly loadedExtensionId?: string } {
  return result.details!.commandFacts as ListExtensionsDetails & { loadedExtensionId?: string };
}
import type { ExtensionId, RefreshGeneratedContextRequest, StateContractError } from "@svvy/core";
import {
  runtimeActorExtensionBindingStatePortFromStore,
  runtimeCommandStatePortFromStore,
  runtimeTurnStatePortFromStore,
} from "@svvy/state/structured-session-adapters";
import {
  createStructuredSessionStateStore,
  type StructuredSessionStateStore,
} from "@svvy/state/structured-session-state";
import { EXECUTE_TYPESCRIPT_API_DECLARATION } from "../../generated/execute-typescript-api.generated";
import {
  BUILTIN_EXTENSION_IDS,
  BUILTIN_EXTENSIONS,
  externalInstructionExtensionId,
  getExtensionRecord,
  resolveActorExtensionState,
  visibleExtensionRecords,
} from "@svvy/extensions";

const WORKSPACE = {
  id: "/repo/svvy",
  label: "svvy",
  cwd: "/repo/svvy",
} as const;

const stores: StructuredSessionStateStore[] = [];

type TestLoadExtensionToolOptions = Omit<
  Parameters<typeof createLoadExtensionToolBase>[0],
  "runAcceptedLoadExtension"
> & {
  refreshGeneratedContext?: (input: RefreshGeneratedContextRequest) => Promise<void>;
};

function createLoadExtensionTool(options: TestLoadExtensionToolOptions) {
  const { refreshGeneratedContext, ...baseOptions } = options;
  return createLoadExtensionToolBase({
    ...baseOptions,
    runAcceptedLoadExtension: fakeAcceptedLoadExtensionRunner(options, refreshGeneratedContext),
  });
}

function createExtensionToolState(store: StructuredSessionStateStore) {
  return {
    actorExtensionBindingState: runtimeActorExtensionBindingStatePortFromStore(store),
    commandState: runtimeCommandStatePortFromStore(store),
    turnState: runtimeTurnStatePortFromStore(store),
    runState: <A>(effect: Effect.Effect<A, StateContractError>) => Effect.runSync(effect),
  };
}

async function noopRefreshGeneratedContext() {}

function fakeAcceptedLoadExtensionRunner(
  options: TestLoadExtensionToolOptions,
  refreshGeneratedContext: TestLoadExtensionToolOptions["refreshGeneratedContext"],
): RunAcceptedLoadExtension {
  return async (request) => {
    const extensionId = request.arguments.extensionId.trim() as ExtensionId;
    const record =
      resolveExtensionRecord(extensionId, options.extensionsRoot) ??
      getExtensionRecord(extensionId);
    if (!record || !request.actorBinding.availableExtensionIds.includes(extensionId)) {
      throw new Error(`Unknown extension: ${extensionId}`);
    }
    if (record.envReadiness === "missing" || record.dependencyReadiness === "missing") {
      throw new Error(`Extension is not ready to load for this actor: ${extensionId}.`);
    }

    const binding = options.state.runState(
      options.state.actorExtensionBindingState.updateActorExtensionBinding({
        target: request.command.target,
        extensionId,
        usage: "loaded",
        reason: "load_extension",
        sourceCommandId: request.command.commandId,
      }),
    ).value;
    await (refreshGeneratedContext ?? noopRefreshGeneratedContext)({
      scope: "target",
      target: request.command.target,
      actorKind: request.command.target.surface === "handler" ? "handler" : "orchestrator",
      reason: "load-extension",
      sourceCommandId: request.command.commandId,
      refreshBoundSurfaceBeforeNextTurn: true,
    });
    options.state.runState(
      options.state.commandState.finishCommand({
        commandId: request.command.commandId,
        status: "succeeded",
        summary: `Loaded extension ${extensionId} for the current actor.`,
        facts: {
          type: "load_extension.finished",
          status: "succeeded",
          extensionId,
          usage: "loaded",
        },
      }),
    );
    return {
      toolResult: {
        content: [{ type: "text", text: `Loaded extension \`${extensionId}\`.` }],
        details: {
          summary: `Loaded extension ${extensionId}.`,
          commandFacts: {
            type: "load_extension.finished",
            status: "succeeded",
            extensionId,
            usage: "loaded",
          },
        },
      },
      appliedEffects: [{ type: "actor_extension_binding.update", binding }],
    };
  };
}

function seedPiExtensionState(
  store: StructuredSessionStateStore,
  input: {
    sessionId: string;
    loadedExtensionIds: readonly string[];
    availableExtensionIds: readonly string[];
  },
) {
  store.updatePiSessionExtensionState({
    sessionId: input.sessionId,
    loadedExtensionIds: [...input.loadedExtensionIds],
    availableExtensionIds: [...input.availableExtensionIds],
  });
}

afterEach(() => {
  while (stores.length > 0) {
    stores.pop()?.close();
  }
});

describe("builtin extension registry", () => {
  it("defines the exhaustive base builtin inventory and actor defaults", () => {
    expect(BUILTIN_EXTENSION_IDS).toEqual([
      "base-common",
      "base-orchestrator",
      "base-handler",
      "base-workflow-task",
      "shell",
      "apply-patch",
      "execute-typescript",
      "extension-loading",
      "extension-managing",
      "request-user-input",
      "thread-orchestration",
      "thread-handling",
      "cx",
      "git",
      "github",
      "web",
      "smithers",
      "workflows",
      "artifacts",
    ]);

    const orchestrator = resolveActorExtensionState({ actor: "orchestrator" });
    expect(orchestrator.loadedExtensionIds).toEqual([
      "base-common",
      "base-orchestrator",
      "shell",
      "apply-patch",
      "execute-typescript",
      "extension-loading",
      "request-user-input",
      "thread-orchestration",
      "cx",
      "git",
      "github",
      "web",
      "artifacts",
    ]);
    expect(orchestrator.availableExtensionIds).toEqual([
      "extension-managing",
      "smithers",
      "workflows",
    ]);
    expect(orchestrator.loadedExtensionIds).toContain("thread-orchestration");
    expect(orchestrator.loadedExtensionIds).not.toContain("thread-handling");
    expect(orchestrator.availableExtensionIds).toContain("smithers");
    expect(orchestrator.availableExtensionIds).toContain("workflows");

    const handler = resolveActorExtensionState({ actor: "handler" });
    expect(handler.loadedExtensionIds).toEqual([
      "base-common",
      "base-handler",
      "shell",
      "apply-patch",
      "execute-typescript",
      "extension-loading",
      "request-user-input",
      "thread-handling",
      "cx",
      "git",
      "github",
      "web",
      "smithers",
      "workflows",
      "artifacts",
    ]);
    expect(handler.availableExtensionIds).toEqual(["extension-managing"]);
    expect(handler.loadedExtensionIds).toContain("thread-handling");
    expect(handler.loadedExtensionIds).toContain("smithers");
    expect(handler.loadedExtensionIds).toContain("workflows");
    expect(handler.loadedExtensionIds).not.toContain("thread-orchestration");

    const workflowTask = resolveActorExtensionState({ actor: "workflow-task" });
    expect(workflowTask.loadedExtensionIds).toEqual([
      "base-common",
      "base-workflow-task",
      "shell",
      "apply-patch",
      "execute-typescript",
      "extension-loading",
      "cx",
      "git",
      "web",
      "artifacts",
    ]);
    expect(workflowTask.availableExtensionIds).toEqual(["github"]);
    expect(workflowTask.loadedExtensionIds).toContain("base-workflow-task");
    expect(workflowTask.availableExtensionIds).toContain("github");
    expect(workflowTask.loadedExtensionIds).not.toContain("smithers");
    expect(workflowTask.availableExtensionIds).not.toContain("workflows");

    const threadOrchestration = BUILTIN_EXTENSIONS.find(
      (extension) => extension.id === "thread-orchestration",
    );
    const threadHandling = BUILTIN_EXTENSIONS.find(
      (extension) => extension.id === "thread-handling",
    );
    const extensionManaging = BUILTIN_EXTENSIONS.find(
      (extension) => extension.id === "extension-managing",
    );
    expect(threadOrchestration).toMatchObject({
      interface: "native_tool",
      instructionSourceFiles: [],
    });
    expect(threadHandling).toMatchObject({
      interface: "native_tool",
      instructionSourceFiles: [],
    });
    expect(extensionManaging).toMatchObject({
      interface: "svvyx",
      typescriptApiEnabled: false,
    });
    expect(builtinLoadedInstructionDefaults("thread-orchestration")).toEqual([
      expect.objectContaining({ name: "010-thread-orchestration.md" }),
    ]);
    expect(builtinLoadedInstructionDefaults("thread-handling")).toEqual([
      expect.objectContaining({ name: "010-thread-handling.md" }),
    ]);

    for (const extension of BUILTIN_EXTENSIONS) {
      expect(extension.category).toBe("builtin");
      expect(["instructions", "native_tool", "svvyx"]).toContain(extension.interface);
      const generatedInstructionCount =
        "generatedInstructions" in extension ? extension.generatedInstructions.length : 0;
      expect(
        extension.instructionSourceFiles.length +
          builtinLoadedInstructionDefaults(extension.id).length +
          generatedInstructionCount,
      ).toBeGreaterThan(0);
      expect(extension.minimalLoadingHint.trim().length).toBeGreaterThan(0);
      expect(["ready", "not_required", "missing"]).toContain(extension.envReadiness);
      expect(["ready", "not_required", "missing"]).toContain(extension.dependencyReadiness);
      expect(extension.resetBehavior).toBe("builtin_reset");
      expect(extension.deleteBehavior).toBe("not_allowed");
      if (extension.typescriptApiEnabled) {
        expect(extension.interface).toBe("svvyx");
      }
    }
  });

  it("declares base actor prompts as direct builtin instruction files", () => {
    expect(getExtensionRecord("base-common")?.generatedInstructions).toBeUndefined();
    expect(getExtensionRecord("base-orchestrator")?.generatedInstructions).toBeUndefined();
    expect(getExtensionRecord("base-handler")?.generatedInstructions).toBeUndefined();
    expect(getExtensionRecord("base-workflow-task")?.generatedInstructions).toBeUndefined();
    expect(builtinLoadedInstructionDefaults("base-common")).toEqual([
      expect.objectContaining({ name: "010-base-common.md" }),
    ]);
    expect(builtinLoadedInstructionDefaults("base-orchestrator")).toEqual([
      expect.objectContaining({ name: "010-base-orchestrator.md" }),
    ]);
    expect(builtinLoadedInstructionDefaults("base-handler")).toEqual([
      expect.objectContaining({ name: "010-base-handler.md" }),
    ]);
    expect(builtinLoadedInstructionDefaults("base-workflow-task")).toEqual([
      expect.objectContaining({ name: "010-base-workflow-task.md" }),
    ]);
  });

  it("keeps Extension Loading fixed loaded through profile and thread overrides", () => {
    const state = resolveActorExtensionState({
      actor: "orchestrator",
      profileExtensionUsage: {
        "extension-loading": "unavailable",
      },
      overrides: {
        "extension-loading": "available",
      },
    });

    expect(state.loadedExtensionIds).toContain("extension-loading");
    expect(state.availableExtensionIds).not.toContain("extension-loading");
  });

  it("lets profile usage load or expose builtin extensions regardless of actor default", () => {
    const handlerState = resolveActorExtensionState({
      actor: "handler",
      profileExtensionUsage: {
        "thread-orchestration": "loaded",
      },
    });
    const workflowState = resolveActorExtensionState({
      actor: "workflow-task",
      profileExtensionUsage: {
        workflows: "available",
      },
    });

    expect(handlerState.loadedExtensionIds).toContain("thread-orchestration");
    expect(workflowState.availableExtensionIds).toContain("workflows");
  });

  it("preserves explicit user extension ids from profile usage", () => {
    const state = resolveActorExtensionState({
      actor: "orchestrator",
      profileExtensionUsage: {
        jira: "loaded",
        notes: "loaded",
        linear: "available",
        old: "unavailable",
      },
    });

    expect(state.loadedExtensionIds).toContain("jira");
    expect(state.loadedExtensionIds).toContain("notes");
    expect(state.availableExtensionIds).toContain("linear");
    expect(state.loadedExtensionIds).not.toContain("old");
    expect(state.availableExtensionIds).not.toContain("old");
  });

  it("applies app extension defaults only to orchestrator and workflow-task actors", () => {
    const defaults = {
      order: ["team-notes", "shell"],
      usage: {
        orchestrator: { "team-notes": "loaded" },
        handler: { "team-notes": "loaded" },
        "workflow-task": { "team-notes": "available" },
      },
    } as const;

    const orchestrator = resolveActorExtensionState({
      actor: "orchestrator",
      defaultExtensionOrder: defaults.order,
      defaultExtensionUsage: defaults.usage,
    });
    const handler = resolveActorExtensionState({
      actor: "handler",
      defaultExtensionOrder: defaults.order,
      defaultExtensionUsage: defaults.usage,
    });
    const workflowTask = resolveActorExtensionState({
      actor: "workflow-task",
      defaultExtensionOrder: defaults.order,
      defaultExtensionUsage: defaults.usage,
    });

    expect(orchestrator.loadedExtensionIds[0]).toBe("team-notes");
    expect(handler.loadedExtensionIds).not.toContain("team-notes");
    expect(handler.availableExtensionIds).not.toContain("team-notes");
    expect(workflowTask.availableExtensionIds).toContain("team-notes");
  });

  it("declares pinned and unpinned prompt-only CLI requirements", async () => {
    const store = createStore("session-extension-cli-requirements");
    const turn = store.startTurn({
      sessionId: "session-extension-cli-requirements",
      surfacePiSessionId: "session-extension-cli-requirements",
      requestSummary: "List extensions",
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-cli-requirements",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-cli-requirements",
        threadId: null,
        surfaceKind: "handler",
        defaultEpisodeKind: "analysis",
        rootThreadId: null,
        rootEpisodeKind: "analysis",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["cx", "git", "github", "web", "smithers"],
        availableExtensionIds: [],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    const result = await createListExtensionsTool({
      runtime,
      state: createExtensionToolState(store),
    }).execute("tool-call-list", {});
    const byId = new Map(extFacts(result)!.loaded.map((extension) => [extension.id, extension]));

    expect(byId.get("cx")?.cliRequirements).toEqual([
      {
        id: "cx",
        package: "cx-cli",
        binary: "cx",
        required: true,
        version: "0.7.1",
        versionCommand: "cx --version",
        installCommand: "cargo install cx-cli --version {{version}}",
      },
    ]);
    expect(byId.get("cx")?.generatedInstructions).toEqual([
      {
        output: "instructions/full/010-cx-skill.generated.md",
        script: "scripts/generate-cx-skill.ts",
        versionCliRequirementId: "cx",
      },
    ]);
    for (const instruction of byId.get("cx")?.generatedInstructions ?? []) {
      expect(existsSync(instruction.script)).toBe(true);
    }
    expect(byId.get("git")?.cliRequirements).toEqual([
      {
        id: "git",
        binary: "git",
        required: true,
        versionCommand: "git --version",
      },
    ]);
    expect(byId.get("github")?.cliRequirements).toEqual([
      {
        id: "git",
        binary: "git",
        required: true,
        versionCommand: "git --version",
      },
      {
        id: "gh",
        binary: "gh",
        required: true,
        versionCommand: "gh --version",
      },
    ]);
    expect(byId.get("web")?.cliRequirements).toEqual([
      {
        id: "tinyfish",
        package: "@tiny-fish/cli",
        binary: "tinyfish",
        required: true,
        version: "0.1.6",
        nodeRequirement: ">=24.0.0",
        versionCommand: "tinyfish --version",
        installCommand: "npm install -g @tiny-fish/cli@{{version}}",
      },
    ]);
    expect(byId.get("smithers")?.cliRequirements).toEqual([
      {
        id: "smithers-orchestrator",
        package: "smithers-orchestrator",
        binary: "bunx",
        required: true,
        version: "0.22.0",
        versionCommand: "bunx smithers-orchestrator --version",
      },
    ]);
    expect(byId.get("smithers")?.generatedInstructions).toEqual([
      {
        output: "instructions/full/010-smithers-core.generated.md",
        script: "scripts/generate-smithers-fragment.ts",
        versionCliRequirementId: "smithers-orchestrator",
      },
      {
        output: "instructions/full/040-smithers-memory.generated.md",
        script: "scripts/generate-smithers-fragment.ts",
        versionCliRequirementId: "smithers-orchestrator",
      },
    ]);
    expect(byId.get("smithers")?.instructionFiles).toEqual([
      {
        file: "010-smithers-core.generated.md",
        bypassed: false,
      },
      {
        file: "020-smithers-handler.md",
        bypassed: false,
      },
      {
        file: "030-smithers-svvy-boundary.md",
        bypassed: false,
      },
      {
        file: "040-smithers-memory.generated.md",
        bypassed: true,
      },
    ]);
    for (const instruction of byId.get("smithers")?.generatedInstructions ?? []) {
      expect(existsSync(instruction.script)).toBe(true);
    }
  });

  it("declares Web as prompt-only TinyFish guidance with the exact CLI requirement", () => {
    const web = BUILTIN_EXTENSIONS.find((extension) => extension.id === "web");

    expect(web).toMatchObject({
      id: "web",
      category: "builtin",
      interface: "instructions",
      title: "Web",
      description: "Prompt-only TinyFish CLI guidance.",
      instructionSourceFiles: [],
      minimalLoadingHint:
        "Use TinyFish through Shell for web research when network access is enabled.",
      typescriptApiEnabled: false,
      envReadiness: "ready",
      dependencyReadiness: "ready",
      resetBehavior: "builtin_reset",
      deleteBehavior: "not_allowed",
      generatedInstructions: [
        {
          output: "instructions/full/010-tinyfish-cli.generated.md",
          script: "scripts/generate-tinyfish-cli.ts",
          versionCliRequirementId: "tinyfish",
        },
      ],
      cliRequirements: [
        {
          id: "tinyfish",
          package: "@tiny-fish/cli",
          binary: "tinyfish",
          required: true,
          version: "0.1.6",
          nodeRequirement: ">=24.0.0",
          versionCommand: "tinyfish --version",
          installCommand: "npm install -g @tiny-fish/cli@{{version}}",
        },
      ],
    });
  });

  it("gates Web extension visibility when network access is disabled", () => {
    for (const actor of ["orchestrator", "handler", "workflow-task"] as const) {
      const withNetwork = resolveActorExtensionState({
        actor,
        networkAccess: true,
      });
      const withoutNetwork = resolveActorExtensionState({
        actor,
        networkAccess: false,
      });

      expect(withNetwork.loadedExtensionIds).toContain("web");
      expect(withNetwork.availableExtensionIds).not.toContain("web");
      expect(withoutNetwork.loadedExtensionIds).not.toContain("web");
      expect(withoutNetwork.availableExtensionIds).not.toContain("web");
    }
  });

  it("keeps generated runtime facades limited to loaded svvyx extensions and hides unavailable records", () => {
    const typeScriptClientExtensions = BUILTIN_EXTENSIONS.filter(
      (extension) => extension.typescriptApiEnabled,
    );
    expect(typeScriptClientExtensions.map((extension) => extension.id)).toEqual([
      "workflows",
      "artifacts",
    ]);
    expect(typeScriptClientExtensions.every((extension) => extension.interface === "svvyx")).toBe(
      true,
    );

    for (const extension of BUILTIN_EXTENSIONS) {
      if (extension.interface === "instructions") {
        expect(extension.typescriptApiEnabled).toBe(false);
      }
    }
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("cx");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("tinyfish");
    expect(EXECUTE_TYPESCRIPT_API_DECLARATION).not.toContain("smithers");

    const workflowTask = resolveActorExtensionState({ actor: "workflow-task" });
    const visible = visibleExtensionRecords(workflowTask);
    const visibleIds = [
      ...visible.loaded.map((extension) => extension.id),
      ...visible.available.map((extension) => extension.id),
    ];
    expect(visibleIds).toContain("github");
    expect(visibleIds).not.toContain("extension-managing");
    expect(visibleIds).not.toContain("request-user-input");
    expect(visibleIds).not.toContain("thread-orchestration");
    expect(visibleIds).not.toContain("thread-handling");
    expect(visibleIds).not.toContain("smithers");
    expect(visibleIds).not.toContain("workflows");
  });

  it("materializes discovered external instructions as read-only loaded extension records", () => {
    const loadedSource = {
      id: "0:/repo/svvy/AGENTS.md",
      kind: "AGENTS.md",
      title: "AGENTS.md",
      path: "/repo/svvy/AGENTS.md",
      content: "# Standards",
      contentHash: "abc123",
      order: 0,
      enabled: true,
      actors: ["orchestrator", "handler", "workflow-task"],
      sourceGroup: "workspace_chain",
      readStatus: { status: "readable" },
    } as const;
    const disabledSource = {
      id: "1:/repo/svvy/CLAUDE.md",
      kind: "CLAUDE.md",
      title: "CLAUDE.md",
      path: "/repo/svvy/CLAUDE.md",
      content: "# Claude Standards",
      contentHash: "def456",
      order: 1,
      enabled: false,
      actors: ["orchestrator", "handler", "workflow-task"],
      sourceGroup: "workspace_chain",
      readStatus: { status: "readable" },
    } as const;
    const visible = visibleExtensionRecords({
      loadedExtensionIds: ["base-common"],
      availableExtensionIds: ["smithers"],
      externalInstructionSources: [loadedSource, disabledSource],
    });
    const external = visible.loaded.find(
      (extension) => extension.category === "external_instruction",
    );

    expect(external).toEqual({
      id: externalInstructionExtensionId(loadedSource),
      category: "external_instruction",
      interface: "instructions",
      title: "AGENTS.md",
      description: "Read-only AGENTS.md external instruction file.",
      instructionSourceFiles: ["/repo/svvy/AGENTS.md"],
      minimalLoadingHint:
        "External instruction files are loaded read-only when enabled for this actor.",
      typescriptApiEnabled: false,
      envReadiness: "not_required",
      dependencyReadiness: "not_required",
      resetBehavior: "external_refresh",
      deleteBehavior: "not_allowed",
      state: "loaded",
    });
    expect(visible.available.map((extension) => extension.id)).toEqual(["smithers"]);
  });
});

describe("extension loading tools", () => {
  it("lists only loaded and available actor-local extension records", async () => {
    const store = createStore();
    const turn = store.startTurn({
      sessionId: "session-extension-tools",
      surfacePiSessionId: "session-extension-tools",
      requestSummary: "List extensions",
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-tools",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-tools",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "analysis",
        rootThreadId: null,
        rootEpisodeKind: "analysis",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell", "thread-orchestration"],
        availableExtensionIds: ["smithers", "workflows"],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    const result = await createListExtensionsTool({
      runtime,
      state: createExtensionToolState(store),
    }).execute("tool-call-list", {});

    expect(extFacts(result)!.loaded.map((extension) => extension.id)).toEqual([
      "shell",
      "thread-orchestration",
    ]);
    expect(extFacts(result)!.available.map((extension) => extension.id)).toEqual([
      "smithers",
      "workflows",
    ]);
    expect(extFacts(result)!.loaded[0]).toHaveProperty("instructionSourceFiles");
    for (const extension of extFacts(result)!.available) {
      expect(extension).not.toHaveProperty("instructionSourceFiles");
      expect(extension.minimalLoadingHint.length).toBeGreaterThan(0);
      expect(extension.minimalInstructionPath).toBeNull();
    }
    for (const extension of [...extFacts(result)!.loaded, ...extFacts(result)!.available]) {
      expect(extension).not.toHaveProperty("fingerprint");
      expect(extension).not.toHaveProperty("generatedContextFingerprint");
      expect(extension).not.toHaveProperty("aggregateCacheKey");
      expect(extension).not.toHaveProperty("secretValues");
      expect(extension).not.toHaveProperty("globalProfileState");
    }
    expect(result.content?.[0]?.type).toBe("text");
    expect(result.content?.[0]?.type === "text" ? result.content[0].text : "").toContain(
      "Loaded extensions",
    );
    expect(store.getSessionState("session-extension-tools").commands).toEqual([
      expect.objectContaining({
        toolName: "list_extensions",
        status: "succeeded",
        arguments: {},
        facts: expect.objectContaining({
          loadedExtensionIds: ["shell", "thread-orchestration"],
          availableExtensionIds: ["smithers", "workflows"],
        }),
      }),
    ]);
  });

  it("lists loaded base prompt extensions from editable builtin source files", async () => {
    const extensionsRoot = mkdtempSync(join(tmpdir(), "svvy-base-list-extension-"));
    try {
      const store = createStore("session-base-extension-tools");
      const turn = store.startTurn({
        sessionId: "session-base-extension-tools",
        surfacePiSessionId: "session-base-extension-tools",
        requestSummary: "List base extensions",
      });
      const runtime: PromptExecutionRuntimeHandle = {
        current: {
          workspaceSessionId: "session-base-extension-tools",
          turnId: turn.id,
          surfacePiSessionId: "session-base-extension-tools",
          threadId: null,
          surfaceKind: "orchestrator",
          defaultEpisodeKind: "analysis",
          rootThreadId: null,
          rootEpisodeKind: "analysis",
          sessionWaitApplied: false,
          threadWasTerminalAtStart: false,
          loadedExtensionIds: ["base-common", "base-orchestrator"],
          availableExtensionIds: [],
          generatedAgentContextFingerprint: "generated_context_fingerprint_test",
          generatedAgentContextRevision: "generated_context_revision_test",
        },
      };

      const result = await createListExtensionsTool({
        runtime,
        state: createExtensionToolState(store),
        extensionsRoot,
      }).execute("tool-call-list-base", {});

      expect(extFacts(result)!.loaded.map((extension) => extension.id)).toEqual([
        "base-common",
        "base-orchestrator",
      ]);
      for (const extension of extFacts(result)!.loaded) {
        expect(extension.instructionSourceFiles).toHaveLength(1);
        expect(extension.instructionSourceFiles[0]).toContain(
          join(extensionsRoot, "sources", "builtin", extension.id, "instructions", "full"),
        );
        expect(extension.instructionSourceFiles[0]).not.toBe("src/bun/default-system-prompt.ts");
      }
    } finally {
      rmSync(extensionsRoot, { recursive: true, force: true });
    }
  });

  it("lists and loads user extension records into refreshed actor context", async () => {
    const extensionsRoot = mkdtempSync(join(tmpdir(), "svvy-user-extension-"));
    try {
      const sourceRoot = join(extensionsRoot, "sources", "user", "notes");
      const fullDir = join(sourceRoot, "instructions", "full");
      mkdirSync(fullDir, { recursive: true });
      writeFileSync(
        join(sourceRoot, "manifest.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            id: "notes",
            title: "Notes",
            description: "User-authored note guidance.",
            interface: "instructions",
            instructionFiles: [
              { file: "010-notes.md", bypassed: false },
              { file: "020-draft.md", bypassed: true },
            ],
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(join(fullDir, "010-notes.md"), "# Notes\n\nUse the notes workspace.");
      writeFileSync(join(fullDir, "020-draft.md"), "# Draft\n\nDo not load this bypassed draft.");
      writeFileSync(
        join(sourceRoot, "instructions", "minimal.md"),
        "Load Notes when workspace notes matter.\n",
      );

      const listStore = createStore("session-user-extension-list");
      const listTurn = listStore.startTurn({
        sessionId: "session-user-extension-list",
        surfacePiSessionId: "session-user-extension-list",
        requestSummary: "List user extensions",
      });
      const listRuntime: PromptExecutionRuntimeHandle = {
        current: {
          workspaceSessionId: "session-user-extension-list",
          turnId: listTurn.id,
          surfacePiSessionId: "session-user-extension-list",
          threadId: null,
          surfaceKind: "orchestrator",
          defaultEpisodeKind: "analysis",
          rootThreadId: null,
          rootEpisodeKind: "analysis",
          sessionWaitApplied: false,
          threadWasTerminalAtStart: false,
          loadedExtensionIds: ["shell"],
          availableExtensionIds: ["notes"],
          generatedAgentContextFingerprint: "generated_context_fingerprint_test",
          generatedAgentContextRevision: "generated_context_revision_test",
        },
      };

      const listed = await createListExtensionsTool({
        runtime: listRuntime,
        state: createExtensionToolState(listStore),
        extensionsRoot,
      }).execute("tool-call-list-user-extension", {});

      expect(extFacts(listed)!.available.map((extension) => extension.id)).toEqual(["notes"]);
      expect(extFacts(listed)!.available[0]).toMatchObject({
        category: "user",
        interface: "instructions",
        minimalLoadingHint: "Load Notes when workspace notes matter.\n",
        resetBehavior: "user_reset",
        deleteBehavior: "trash_allowed",
        envReadiness: "not_required",
        dependencyReadiness: "not_required",
        typescriptApiEnabled: false,
      });
      expect(extFacts(listed)!.available[0]).not.toHaveProperty("instructionSourceFiles");
      expect(extFacts(listed)!.available[0]).not.toHaveProperty("sourceRoot");
      expect(extFacts(listed)!.available[0]).not.toHaveProperty("extensionBuildFingerprint");
      expect(extFacts(listed)!.available[0]).not.toHaveProperty("envDeclarations");
      expect(extFacts(listed)!.available[0]).not.toHaveProperty("dependencies");
      expect(extFacts(listed)!.available[0]).not.toHaveProperty("trustedDependencies");

      const store = createStore("session-user-extension-load");
      seedPiExtensionState(store, {
        sessionId: "session-user-extension-load",
        loadedExtensionIds: ["base-common", "shell"],
        availableExtensionIds: ["notes"],
      });
      const turn = store.startTurn({
        sessionId: "session-user-extension-load",
        surfacePiSessionId: "session-user-extension-load",
        requestSummary: "Load user extension",
      });
      const loadRuntime: PromptExecutionRuntimeHandle = {
        current: {
          workspaceSessionId: "session-user-extension-load",
          turnId: turn.id,
          surfacePiSessionId: "session-user-extension-load",
          threadId: null,
          surfaceKind: "orchestrator",
          defaultEpisodeKind: "change",
          rootThreadId: null,
          rootEpisodeKind: "change",
          sessionWaitApplied: false,
          threadWasTerminalAtStart: false,
          loadedExtensionIds: ["base-common", "shell"],
          availableExtensionIds: ["notes"],
          generatedAgentContextFingerprint: "generated_context_fingerprint_test",
          generatedAgentContextRevision: "generated_context_revision_test",
        },
      };

      const refreshCalls: unknown[] = [];
      const loaded = await createLoadExtensionTool({
        runtime: loadRuntime,
        state: createExtensionToolState(store),
        extensionsRoot,
        refreshGeneratedContext: async (input) => {
          refreshCalls.push(input);
        },
      }).execute("tool-call-load-user-extension", { extensionId: "notes" });

      expect(extFacts(loaded)!.loadedExtensionId).toBe("notes");
      expect(extFacts(loaded)!.available.map((extension) => extension.id)).toEqual([]);
      expect(extFacts(loaded)!.loaded.map((extension) => extension.id)).toEqual([
        "base-common",
        "notes",
        "shell",
      ]);
      const loadedNotes = extFacts(loaded)!.loaded.find((extension) => extension.id === "notes");
      expect(loadedNotes).toHaveProperty("instructionSourceFiles");
      expect(loadedNotes).not.toHaveProperty("sourceRoot");
      expect(loadedNotes).not.toHaveProperty("extensionBuildFingerprint");
      expect(loadedNotes).not.toHaveProperty("envDeclarations");
      expect(loadedNotes).not.toHaveProperty("dependencies");
      expect(loadedNotes).not.toHaveProperty("trustedDependencies");
      expect(extFacts(loaded)!).not.toHaveProperty("refreshedContext");
      expect(refreshCalls).toEqual([
        {
          scope: "target",
          target: {
            workspaceSessionId: "session-user-extension-load",
            surface: "orchestrator",
            surfacePiSessionId: "session-user-extension-load",
          },
          actorKind: "orchestrator",
          reason: "load-extension",
          sourceCommandId: expect.any(String),
          refreshBoundSurfaceBeforeNextTurn: true,
        },
      ]);
    } finally {
      rmSync(extensionsRoot, { recursive: true, force: true });
    }
  });

  it("includes bound external instructions in actor-local extension listings", async () => {
    const store = createStore("session-extension-external-instructions");
    const turn = store.startTurn({
      sessionId: "session-extension-external-instructions",
      surfacePiSessionId: "session-extension-external-instructions",
      requestSummary: "List external instructions",
    });
    const source = {
      id: "0:/repo/svvy/AGENTS.md",
      kind: "AGENTS.md",
      title: "AGENTS.md",
      path: "/repo/svvy/AGENTS.md",
      content: "# Project Standards",
      contentHash: "abc123",
      order: 0,
      enabled: true,
      actors: ["orchestrator", "handler", "workflow-task"],
      sourceGroup: "workspace_chain",
      readStatus: { status: "readable" },
    } as const;
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-external-instructions",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-external-instructions",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "analysis",
        rootThreadId: null,
        rootEpisodeKind: "analysis",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: [],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
        externalInstructionSources: [source],
      },
    };

    const result = await createListExtensionsTool({
      runtime,
      state: createExtensionToolState(store),
    }).execute("tool-call-list", {});
    const external = extFacts(result)!.loaded.find(
      (extension) => extension.id === externalInstructionExtensionId(source),
    );

    expect(external).toMatchObject({
      category: "external_instruction",
      interface: "instructions",
      instructionSourceFiles: ["/repo/svvy/AGENTS.md"],
      typescriptApiEnabled: false,
      resetBehavior: "external_refresh",
      deleteBehavior: "not_allowed",
      state: "loaded",
    });
    expect(result.content?.[0]?.type === "text" ? result.content[0].text : "").toContain(
      externalInstructionExtensionId(source),
    );
  });

  it("keeps external instruction listings actor-local and excludes unreadable loaded rows", async () => {
    const store = createStore("session-extension-external-instructions-actor");
    const turn = store.startTurn({
      sessionId: "session-extension-external-instructions-actor",
      surfacePiSessionId: "session-extension-external-instructions-actor",
      requestSummary: "List actor-local external instructions",
    });
    const handlerOnly = {
      id: "0:/repo/svvy/AGENTS.md",
      kind: "AGENTS.md",
      title: "AGENTS.md",
      path: "/repo/svvy/AGENTS.md",
      content: "# Handler Standards",
      contentHash: "abc123",
      order: 0,
      enabled: true,
      actors: ["handler"],
      sourceGroup: "workspace_chain",
      readStatus: { status: "readable" },
    } as const;
    const unreadable = {
      id: "1:/repo/svvy/CLAUDE.md",
      kind: "CLAUDE.md",
      title: "CLAUDE.md",
      path: "/repo/svvy/CLAUDE.md",
      content: "",
      contentHash: "",
      order: 1,
      enabled: true,
      actors: ["orchestrator"],
      sourceGroup: "workspace_chain",
      readStatus: { status: "unreadable", error: "permission denied" },
    } as const;
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-external-instructions-actor",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-external-instructions-actor",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "analysis",
        rootThreadId: null,
        rootEpisodeKind: "analysis",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: [],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
        externalInstructionSources: [handlerOnly, unreadable],
      },
    };

    const result = await createListExtensionsTool({
      runtime,
      state: createExtensionToolState(store),
    }).execute("tool-call-list", {});

    expect(extFacts(result)!.loaded.map((extension) => extension.id)).not.toContain(
      externalInstructionExtensionId(handlerOnly),
    );
    expect(extFacts(result)!.loaded.map((extension) => extension.id)).not.toContain(
      externalInstructionExtensionId(unreadable),
    );
    expect(extFacts(result)!.available.map((extension) => extension.id)).not.toContain(
      externalInstructionExtensionId(handlerOnly),
    );
    expect(extFacts(result)!.available.map((extension) => extension.id)).not.toContain(
      externalInstructionExtensionId(unreadable),
    );
  });

  it("loads an available extension into a handler thread and persists the binding", async () => {
    const store = createStore();
    seedPiExtensionState(store, {
      sessionId: "session-extension-tools",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
    });
    const turn = store.startTurn({
      sessionId: "session-extension-tools",
      surfacePiSessionId: "pi-handler-extension-tools",
      requestSummary: "Load extension",
    });
    const thread = store.createThread({
      turnId: turn.id,
      surfacePiSessionId: "pi-handler-extension-tools",
      title: "Load extension thread",
      objective: "Load an actor-local extension.",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-tools",
        turnId: turn.id,
        surfacePiSessionId: "pi-handler-extension-tools",
        threadId: thread.id,
        surfaceKind: "handler",
        defaultEpisodeKind: "change",
        rootThreadId: thread.id,
        rootEpisodeKind: "change",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    const refreshCalls: unknown[] = [];
    const result = await createLoadExtensionTool({
      runtime,
      state: createExtensionToolState(store),
      refreshGeneratedContext: async (input) => {
        refreshCalls.push(input);
      },
    }).execute("tool-call-load", {
      extensionId: "smithers",
    });

    expect(extFacts(result)!.loadedExtensionId).toBe("smithers");
    expect(runtime.current?.loadedExtensionIds).toEqual(["shell", "smithers"]);
    expect(runtime.current?.availableExtensionIds).toEqual([]);
    expect(extFacts(result)!).not.toHaveProperty("refreshedContext");
    expect(result.content?.[0]?.type === "text" ? result.content[0].text : "").toBe(
      "Loaded extension `smithers`.",
    );
    expect(result.content?.[0]?.type === "text" ? result.content[0].text : "").not.toContain(
      "Loaded prompt-only extension: Smithers.",
    );

    const refreshed = store.getThreadDetail(thread.id).thread;
    expect(refreshed.loadedExtensionIds).toEqual(["shell", "smithers"]);
    expect(refreshed.availableExtensionIds).toEqual([]);
    expect(store.getSessionState("session-extension-tools").commands).toContainEqual(
      expect.objectContaining({
        toolName: "load_extension",
        status: "succeeded",
        arguments: {
          extensionId: "smithers",
        },
        facts: expect.objectContaining({
          type: "load_extension.finished",
          status: "succeeded",
          extensionId: "smithers",
          usage: "loaded",
        }),
      }),
    );
    expect(refreshCalls).toEqual([
      {
        scope: "target",
        target: {
          workspaceSessionId: "session-extension-tools",
          surface: "handler",
          surfacePiSessionId: "pi-handler-extension-tools",
          threadId: thread.id,
        },
        actorKind: "handler",
        reason: "load-extension",
        sourceCommandId: expect.any(String),
        refreshBoundSurfaceBeforeNextTurn: true,
      },
    ]);
  });

  it("loads an available extension into an orchestrator session and persists the binding", async () => {
    const store = createStore();
    seedPiExtensionState(store, {
      sessionId: "session-extension-tools",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
    });
    const turn = store.startTurn({
      sessionId: "session-extension-tools",
      surfacePiSessionId: "session-extension-tools",
      requestSummary: "Load orchestrator extension",
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-tools",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-tools",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "change",
        rootThreadId: null,
        rootEpisodeKind: "change",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    const refreshCalls: unknown[] = [];
    const result = await createLoadExtensionTool({
      runtime,
      state: createExtensionToolState(store),
      refreshGeneratedContext: async (input) => {
        refreshCalls.push(input);
      },
    }).execute("tool-call-load", {
      extensionId: "smithers",
    });

    expect(extFacts(result)!.loadedExtensionId).toBe("smithers");
    expect(runtime.current?.loadedExtensionIds).toEqual(["shell", "smithers"]);
    expect(runtime.current?.availableExtensionIds).toEqual([]);

    const refreshed = store.getSessionState("session-extension-tools").pi;
    expect(refreshed.loadedExtensionIds).toEqual(["shell", "smithers"]);
    expect(refreshed.availableExtensionIds).toEqual([]);
    expect(refreshCalls).toEqual([
      {
        scope: "target",
        target: {
          workspaceSessionId: "session-extension-tools",
          surface: "orchestrator",
          surfacePiSessionId: "session-extension-tools",
        },
        actorKind: "orchestrator",
        reason: "load-extension",
        sourceCommandId: expect.any(String),
        refreshBoundSurfaceBeforeNextTurn: true,
      },
    ]);
  });

  it("records a failed command when generated-context refresh scheduling fails", async () => {
    const store = createStore("session-extension-refresh-fail");
    seedPiExtensionState(store, {
      sessionId: "session-extension-refresh-fail",
      loadedExtensionIds: ["shell"],
      availableExtensionIds: ["smithers"],
    });
    const turn = store.startTurn({
      sessionId: "session-extension-refresh-fail",
      surfacePiSessionId: "session-extension-refresh-fail",
      requestSummary: "Load failed extension refresh",
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-refresh-fail",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-refresh-fail",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "change",
        rootThreadId: null,
        rootEpisodeKind: "change",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        generatedAgentContextFingerprint: "previous-fingerprint",
        generatedAgentContextRevision: "previous-revision",
      },
    };

    await expect(
      createLoadExtensionTool({
        runtime,
        state: createExtensionToolState(store),
        refreshGeneratedContext: async () => {
          throw new Error("refresh failed");
        },
      }).execute("tool-call-load", { extensionId: "smithers" }),
    ).rejects.toThrow("refresh failed");

    expect(store.getSessionState("session-extension-refresh-fail").commands).toContainEqual(
      expect.objectContaining({
        toolName: "load_extension",
        status: "failed",
        arguments: {
          extensionId: "smithers",
        },
        error: "refresh failed",
      }),
    );
  });

  it("records failed command facts for rejected load_extension requests", async () => {
    const store = createStore();
    seedPiExtensionState(store, {
      sessionId: "session-extension-tools",
      loadedExtensionIds: ["execute-typescript", "shell"],
      availableExtensionIds: ["workflows"],
    });
    const turn = store.startTurn({
      sessionId: "session-extension-tools",
      surfacePiSessionId: "session-extension-tools",
      requestSummary: "Load missing extension",
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-tools",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-tools",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "change",
        rootThreadId: null,
        rootEpisodeKind: "change",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    await expect(
      createLoadExtensionTool({
        runtime,
        state: createExtensionToolState(store),
        refreshGeneratedContext: noopRefreshGeneratedContext,
      }).execute("tool-call-load-missing", {
        extensionId: "missing-extension",
      }),
    ).rejects.toThrow("Unknown extension: missing-extension");

    expect(store.getSessionState("session-extension-tools").commands).toContainEqual(
      expect.objectContaining({
        toolName: "load_extension",
        status: "failed",
        arguments: {
          extensionId: "missing-extension",
        },
        error: "Unknown extension: missing-extension",
      }),
    );
  });

  it("does not return generated prompt or TypeScript declaration previews after loading", async () => {
    const store = createStore();
    seedPiExtensionState(store, {
      sessionId: "session-extension-tools",
      loadedExtensionIds: ["execute-typescript", "shell"],
      availableExtensionIds: ["workflows"],
    });
    const turn = store.startTurn({
      sessionId: "session-extension-tools",
      surfacePiSessionId: "session-extension-tools",
      requestSummary: "Load Workflows",
    });
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-tools",
        turnId: turn.id,
        surfacePiSessionId: "session-extension-tools",
        threadId: null,
        surfaceKind: "orchestrator",
        defaultEpisodeKind: "change",
        rootThreadId: null,
        rootEpisodeKind: "change",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["execute-typescript", "shell"],
        availableExtensionIds: ["workflows"],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    const result = await createLoadExtensionTool({
      runtime,
      state: createExtensionToolState(store),
      refreshGeneratedContext: noopRefreshGeneratedContext,
    }).execute("tool-call-load", {
      extensionId: "workflows",
    });

    expect(extFacts(result)!).not.toHaveProperty("refreshedContext");
    expect(extFacts(result)!).not.toHaveProperty("systemPrompt");
    expect(extFacts(result)!).not.toHaveProperty("executeTypescriptDeclaration");

    const refreshed = store.getSessionState("session-extension-tools").pi;
    expect(refreshed.loadedExtensionIds).toEqual(["execute-typescript", "shell", "workflows"]);
    expect(refreshed.availableExtensionIds).toEqual([]);
  });

  it("loads custom-root user svvyx extensions without returning generated runtime facades", async () => {
    const extensionsRoot = mkdtempSync(join(tmpdir(), "svvy-user-extension-types-"));
    try {
      const sourceRoot = join(extensionsRoot, "sources", "user", "linear");
      const currentRoot = join(extensionsRoot, "builds", "extensions", "linear", "current");
      const generatedRoot = join(extensionsRoot, "generated", "extensions", "linear");
      mkdirSync(join(sourceRoot, "instructions", "full"), { recursive: true });
      mkdirSync(join(sourceRoot, "instructions"), { recursive: true });
      mkdirSync(currentRoot, { recursive: true });
      mkdirSync(generatedRoot, { recursive: true });
      writeFileSync(join(sourceRoot, "instructions", "full", "010-main.md"), "# Linear\n");
      writeFileSync(join(sourceRoot, "instructions", "minimal.md"), "Load Linear.");
      writeFileSync(
        join(sourceRoot, "manifest.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            id: "linear",
            title: "Linear",
            description: "Linear generated runtime facade.",
            interface: "svvyx",
            typescriptApiEnabled: true,
            instructionFiles: [{ file: "010-main.md", bypassed: false }],
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(
        join(currentRoot, "manifest.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            extensionId: "linear",
            interface: "svvyx",
            module: "source/index.js",
            commandManifest: {
              version: "incur.v1",
              commands: [{ name: "issues.list" }],
            },
            typescriptTypes: join(generatedRoot, "types.d.ts"),
            env: [],
            dependencies: [],
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(
        join(generatedRoot, "types.d.ts"),
        "interface LoadedExtensionsFacade { staleGeneratedFile: { run(): never } }",
      );
      const store = createStore();
      seedPiExtensionState(store, {
        sessionId: "session-extension-tools",
        loadedExtensionIds: ["execute-typescript"],
        availableExtensionIds: ["linear"],
      });
      const turn = store.startTurn({
        sessionId: "session-extension-tools",
        surfacePiSessionId: "session-extension-tools",
        requestSummary: "Load Linear",
      });
      const runtime: PromptExecutionRuntimeHandle = {
        current: {
          workspaceSessionId: "session-extension-tools",
          turnId: turn.id,
          surfacePiSessionId: "session-extension-tools",
          threadId: null,
          surfaceKind: "orchestrator",
          defaultEpisodeKind: "change",
          rootThreadId: null,
          rootEpisodeKind: "change",
          sessionWaitApplied: false,
          threadWasTerminalAtStart: false,
          loadedExtensionIds: ["execute-typescript"],
          availableExtensionIds: ["linear"],
          generatedAgentContextFingerprint: "generated_context_fingerprint_test",
          generatedAgentContextRevision: "generated_context_revision_test",
        },
      };

      const result = await createLoadExtensionTool({
        runtime,
        state: createExtensionToolState(store),
        extensionsRoot,
        refreshGeneratedContext: noopRefreshGeneratedContext,
      }).execute("tool-call-load", { extensionId: "linear" });

      expect(extFacts(result)!.loadedExtensionId).toBe("linear");
      expect(extFacts(result)!.loaded.map((extension) => extension.id)).toEqual([
        "execute-typescript",
        "linear",
      ]);
      expect(extFacts(result)!.available.map((extension) => extension.id)).toEqual([]);
      expect(extFacts(result)!).not.toHaveProperty("refreshedContext");
      expect(JSON.stringify(extFacts(result)!)).not.toContain("staleGeneratedFile");
      expect(JSON.stringify(extFacts(result)!)).not.toContain("LinearExtensionFacade");
    } finally {
      rmSync(extensionsRoot, { recursive: true, force: true });
    }
  });

  it("rejects the removed id parameter for load_extension", async () => {
    const store = createStore();
    const runtime: PromptExecutionRuntimeHandle = {
      current: {
        workspaceSessionId: "session-extension-tools",
        turnId: "turn-load-extension-schema",
        surfacePiSessionId: "pi-handler-extension-tools",
        threadId: null,
        surfaceKind: "handler",
        defaultEpisodeKind: "change",
        rootThreadId: null,
        rootEpisodeKind: "change",
        sessionWaitApplied: false,
        threadWasTerminalAtStart: false,
        loadedExtensionIds: ["shell"],
        availableExtensionIds: ["smithers"],
        generatedAgentContextFingerprint: "generated_context_fingerprint_test",
        generatedAgentContextRevision: "generated_context_revision_test",
      },
    };

    await expect(
      createLoadExtensionTool({
        runtime,
        state: createExtensionToolState(store),
        refreshGeneratedContext: noopRefreshGeneratedContext,
      }).execute("tool-call-load", {
        id: "smithers",
      } as never),
    ).rejects.toThrow();
  });
});

function createStore(sessionId = "session-extension-tools"): StructuredSessionStateStore {
  const store = createStructuredSessionStateStore({
    workspace: WORKSPACE,
  });
  stores.push(store);
  store.upsertPiSession({
    sessionId,
    title: "Extension Tools Session",
    provider: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    messageCount: 1,
    status: "running",
    createdAt: "2026-06-08T09:00:00.000Z",
    updatedAt: "2026-06-08T09:00:00.000Z",
  });
  return store;
}
