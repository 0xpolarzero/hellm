import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { createAgentSettingsStore } from "./agent-settings-store";
import {
  AMBIENT_AGENT_RESOURCE_CATEGORIES,
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  DEFAULT_ORCHESTRATOR_PROFILE_ID,
  DEFAULT_THREAD_HANDLER_PROFILE_ID,
  type AmbientAgentResourcesSettings,
} from "../shared/agent-settings";

function ambientResources(
  overrides: Partial<Record<string, unknown>> = {},
): AmbientAgentResourcesSettings {
  return {
    categories: {
      ...Object.fromEntries(
        AMBIENT_AGENT_RESOURCE_CATEGORIES.map((category) => [category, { enabled: false }]),
      ),
      ...overrides,
    } as AmbientAgentResourcesSettings["categories"],
    enablements: [],
  };
}

describe("agent profile settings", () => {
  it("persists agent profile state and seeds conventional workflow agents", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-agent-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAgentProfile({
      id: "repo-orchestrator",
      kind: "orchestrator",
      name: "Repo orchestrator",
      provider: "openai",
      model: "gpt-5.4-mini",
      reasoningEffort: "low",
      systemPrompt: "Own repository strategy.",
      extensionUsage: {},
      extensionOrder: ["git", "cx", "web"],
      updateFromComposer: false,
      builtin: false,
      locked: false,
    });

    expect(updated.agents.orchestrators.map((agent) => agent.id)).toContain(
      DEFAULT_ORCHESTRATOR_PROFILE_ID,
    );
    expect(updated.agents.orchestrators).toContainEqual(
      expect.objectContaining({
        id: "repo-orchestrator",
        provider: "openai",
        model: "gpt-5.4-mini",
        reasoningEffort: "low",
        systemPrompt: "Own repository strategy.",
        extensionOrder: ["git", "cx", "web"],
      }),
    );
    expect(updated.agents.special.threadHandler.id).toBe(DEFAULT_THREAD_HANDLER_PROFILE_ID);
    expect(updated.agents.titleNamer.provider).toBe("openai-codex");
    expect(updated.agents.titleNamer.model).toBe("gpt-5.4-mini");
    expect(updated.agents.titleNamer.reasoningEffort).toBe("low");

    expect(updated.workflowAgents.explorer!.instructions).toContain("Inspect the repository");
    expect(updated.workflowAgents.explorer!.extensions).toEqual([]);
    expect(existsSync(join(root, "workflows", "agents", "explorer.agent.json"))).toBe(true);
    expect(existsSync(join(root, "workflows", "agents", "implementer.agent.json"))).toBe(true);
    expect(existsSync(join(root, "workflows", "agents", "reviewer.agent.json"))).toBe(true);
    expect(existsSync(join(root, ".svvy", "workflows", "components", "agents.ts"))).toBe(false);
  });

  it("updates the locked thread handler profile through the special profile slot", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-thread-handler-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAgentProfile({
      ...store.getState().agents.special.threadHandler,
      provider: "anthropic",
      model: "claude-sonnet-4",
      reasoningEffort: "high",
      systemPrompt: "Supervise delegated workflow work.",
    });

    expect(updated.agents.special.threadHandler).toEqual(
      expect.objectContaining({
        id: DEFAULT_THREAD_HANDLER_PROFILE_ID,
        provider: "anthropic",
        model: "claude-sonnet-4",
        reasoningEffort: "high",
        systemPrompt: "Supervise delegated workflow work.",
        locked: true,
      }),
    );
  });

  it("persists app-global non-secret extension env overrides", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-extension-env-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setExtensionEnv({
      nonSecretOverrides: {
        " linear ": {
          " LINEAR_API_BASE_URL ": "https://linear.example.test",
          LINEAR_EMPTY_OK: "",
          "": "ignored",
        },
        "": {
          IGNORED: "value",
        },
      },
    });

    expect(updated.extensionEnv.nonSecretOverrides).toEqual({
      linear: {
        LINEAR_API_BASE_URL: "https://linear.example.test",
        LINEAR_EMPTY_OK: "",
      },
    });
    expect(store.getState().extensionEnv.nonSecretOverrides.linear?.LINEAR_API_BASE_URL).toBe(
      "https://linear.example.test",
    );
  });

  it("allows settings edits on the locked default orchestrator while preserving lock policy", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-default-orchestrator-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAgentProfile({
      ...store.getState().agents.orchestrators[0]!,
      name: "Default strategy",
      provider: "anthropic",
      model: "claude-sonnet-4",
      reasoningEffort: "high",
      systemPrompt: "Own the top-level plan.",
      locked: false,
      builtin: false,
    });

    expect(updated.agents.orchestrators[0]).toEqual(
      expect.objectContaining({
        id: DEFAULT_ORCHESTRATOR_PROFILE_ID,
        name: "Default strategy",
        provider: "anthropic",
        model: "claude-sonnet-4",
        reasoningEffort: "high",
        systemPrompt: "Own the top-level plan.",
        locked: true,
        builtin: true,
      }),
    );
  });

  it("creates additional orchestrator profiles as unlocked user profiles", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-new-orchestrator-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAgentProfile({
      id: "custom-orchestrator",
      kind: "orchestrator",
      name: "Custom orchestrator",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      systemPrompt: "Own custom strategy.",
      extensionUsage: {},
      updateFromComposer: false,
      builtin: true,
      locked: true,
    });

    expect(updated.agents.orchestrators).toContainEqual(
      expect.objectContaining({
        id: "custom-orchestrator",
        builtin: false,
        locked: false,
      }),
    );
  });

  it("keeps workflow agent settings as data-only records", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-workflow-agent-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    store.setWorkflowAgent("reviewer", {
      id: "reviewer",
      label: "Reviewer",
      provider: "anthropic",
      model: "claude-sonnet-4",
      reasoningEffort: "high",
      instructions: "Review strictly.",
      extensions: ["ci"],
      extensionUsage: {
        ci: "default_loaded",
      },
      extensionOrder: [],
    });

    expect(existsSync(join(root, ".svvy", "workflows", "components", "agents.ts"))).toBe(false);
    expect(existsSync(join(root, "workflows", "agents", "reviewer.agent.json"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(root, "workflows", "agents", "reviewer.agent.json"), "utf8")),
    ).toEqual({
      id: "reviewer",
      label: "Reviewer",
      provider: "anthropic",
      model: "claude-sonnet-4",
      reasoningEffort: "high",
      instructions: "Review strictly.",
      extensions: ["ci"],
      extensionUsage: {
        ci: "default_loaded",
      },
      extensionOrder: [],
    });
    expect(store.getState().workflowAgents.reviewer).toEqual(
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-sonnet-4",
        reasoningEffort: "high",
        instructions: "Review strictly.",
        extensions: ["ci"],
      }),
    );
  });

  it("deletes workflow agent settings and source records for failed-save rollback", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-workflow-agent-delete-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    store.setWorkflowAgent("temporary", {
      id: "temporary",
      label: "Temporary",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      instructions: "Temporary agent.",
      extensions: [],
      extensionUsage: {},
    });

    const sourcePath = join(root, "workflows", "agents", "temporary.agent.json");
    expect(existsSync(sourcePath)).toBe(true);

    const updated = store.deleteWorkflowAgent("temporary");

    expect(updated.workflowAgents.temporary).toBeUndefined();
    expect(store.getState().workflowAgents.temporary).toBeUndefined();
    expect(existsSync(sourcePath)).toBe(false);
  });

  it("loads saved workflow-agent source records as Agents pane profile state", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-workflow-agent-source-records-"));
    const workflowsSourceRoot = join(root, "workflows");
    mkdirSync(join(workflowsSourceRoot, "agents"), { recursive: true });
    writeFileSync(
      join(workflowsSourceRoot, "agents", "strictReviewer.agent.json"),
      JSON.stringify(
        {
          id: "strictReviewer",
          label: "Strict Reviewer",
          provider: "openai",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          instructions: "Review strict source records.",
          extensionUsage: {
            git: "default_loaded",
            github: "available",
          },
        },
        null,
        2,
      ),
    );
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot,
    });

    expect(store.getState().workflowAgents.strictReviewer).toEqual({
      id: "strictReviewer",
      label: "Strict Reviewer",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      instructions: "Review strict source records.",
      extensions: ["git"],
      extensionUsage: {
        git: "default_loaded",
        github: "available",
      },
      extensionOrder: [],
    });

    store.setWorkflowAgent("strictReviewer", {
      ...store.getState().workflowAgents.strictReviewer!,
      instructions: "Review the implementation and tests strictly.",
      extensions: ["git"],
      extensionUsage: {
        git: "default_loaded",
        github: "available",
      },
      extensionOrder: [],
    });

    expect(
      JSON.parse(
        readFileSync(join(workflowsSourceRoot, "agents", "strictReviewer.agent.json"), "utf8"),
      ),
    ).toEqual({
      id: "strictReviewer",
      label: "Strict Reviewer",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      instructions: "Review the implementation and tests strictly.",
      extensions: ["git"],
      extensionUsage: {
        git: "default_loaded",
        github: "available",
      },
      extensionOrder: [],
    });
  });

  it("does not resurrect deleted saved workflow-agent records from settings JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-workflow-agent-source-delete-"));
    const workflowsSourceRoot = join(root, "workflows");
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot,
    });

    store.setWorkflowAgent("strictReviewer", {
      id: "strictReviewer",
      label: "Strict Reviewer",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      instructions: "Review strict source records.",
      extensions: ["git"],
      extensionUsage: {
        git: "default_loaded",
      },
    });
    rmSync(join(workflowsSourceRoot, "agents", "strictReviewer.agent.json"));

    expect(store.getState().workflowAgents.strictReviewer).toBeUndefined();
    expect(store.getState().workflowAgents.explorer).toBeDefined();
  });

  it("drops empty extension ids when normalizing workflow agent settings", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-workflow-agent-removed-tool-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setWorkflowAgent("explorer", {
      id: "explorer",
      label: "Explorer",
      provider: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      instructions: "Explore.",
      extensions: ["cx", "", "web"],
      extensionUsage: {},
    });

    expect(updated.workflowAgents.explorer!.extensions).toEqual(["cx", "web"]);
  });

  it("persists preferred external editor preferences", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-editor-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAppPreferences({
      appAppearance: "dark",
      preferredExternalEditor: "custom",
      customExternalEditorCommand: "code --reuse-window",
      artifactDirectory: "~/svvy-artifacts",
      approvalMode: "full-access",
      networkAccess: false,
      externalInstructions: {
        ...DEFAULT_EXTERNAL_INSTRUCTIONS,
        globalRoots: [
          ...DEFAULT_EXTERNAL_INSTRUCTIONS.globalRoots.map((globalRoot) =>
            globalRoot.id === "codex" ? { ...globalRoot, enabled: false } : globalRoot,
          ),
          {
            id: "custom-standards",
            kind: "custom",
            label: "Custom standards",
            path: "/standards",
            enabled: true,
          },
        ],
        globalControls: {
          "/standards/AGENTS.md": {
            enabled: true,
            actors: ["orchestrator"],
          },
        },
        workspaceControls: {
          "/workspace": {
            "/workspace/CLAUDE.md": {
              enabled: false,
              actors: ["handler"],
            },
          },
        },
      },
      ambientAgentResources: ambientResources(),
    });

    expect(updated.appPreferences).toEqual({
      appAppearance: "dark",
      preferredExternalEditor: "custom",
      customExternalEditorCommand: "code --reuse-window",
      artifactDirectory: "~/svvy-artifacts",
      approvalMode: "full-access",
      networkAccess: false,
      externalInstructions: {
        ...DEFAULT_EXTERNAL_INSTRUCTIONS,
        globalRoots: [
          ...DEFAULT_EXTERNAL_INSTRUCTIONS.globalRoots.map((globalRoot) =>
            globalRoot.id === "codex" ? { ...globalRoot, enabled: false } : globalRoot,
          ),
          {
            id: "custom-standards",
            kind: "custom",
            label: "Custom standards",
            path: "/standards",
            enabled: true,
          },
        ],
        globalControls: {
          "/standards/AGENTS.md": {
            enabled: true,
            actors: ["orchestrator"],
          },
        },
        workspaceControls: {
          "/workspace": {
            "/workspace/CLAUDE.md": {
              enabled: false,
              actors: ["handler"],
            },
          },
        },
      },
      ambientAgentResources: ambientResources(),
    });
    expect(store.getState().appPreferences.preferredExternalEditor).toBe("custom");
    expect(store.getState().appPreferences.artifactDirectory).toBe("~/svvy-artifacts");
    expect(store.getState().appPreferences.approvalMode).toBe("full-access");
    expect(store.getState().appPreferences.networkAccess).toBe(false);
  });

  it("persists request_user_input mode and timeout settings", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-request-input-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setRequestUserInput({
      mode: "blocking",
      blockingTimeout: {
        enabled: false,
        durationMs: 45_500,
      },
    });

    expect(updated.requestUserInput).toEqual({
      mode: "blocking",
      blockingTimeout: {
        enabled: false,
        durationMs: 45_500,
      },
    });
    expect(store.getState().requestUserInput).toEqual(updated.requestUserInput);
  });

  it("normalizes missing or invalid request_user_input settings to nonblocking five-minute defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-invalid-request-input-settings-"));
    const agentDir = join(root, ".agent");
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir,
      workflowsSourceRoot: join(root, "workflows"),
    });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "agent-settings.json"),
      `${JSON.stringify({
        version: 2,
        requestUserInput: {
          mode: "old-mode",
          blockingTimeout: {
            enabled: true,
            durationMs: -1,
          },
        },
      })}\n`,
    );

    expect(store.getState().requestUserInput).toEqual({
      mode: "nonblocking",
      blockingTimeout: {
        enabled: true,
        durationMs: 300_000,
      },
    });
  });

  it("defaults invalid appearance preferences to system", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-appearance-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAppPreferences({
      appAppearance: "invalid" as never,
      preferredExternalEditor: "system",
      customExternalEditorCommand: "",
      artifactDirectory: "",
      approvalMode: "unsupported" as never,
      networkAccess: true,
      externalInstructions: {
        globalRoots: [
          {
            id: "pi",
            kind: "builtin",
            label: "pi",
            path: "",
            enabled: false,
          },
          {
            id: "",
            kind: "custom",
            label: "",
            path: "/ignored",
            enabled: true,
          },
          {
            id: "custom-ok",
            kind: "custom",
            label: "",
            path: " /custom ",
            enabled: false,
          },
        ],
        globalControls: {
          "": { enabled: true, actors: ["orchestrator"] },
          "/rules/AGENTS.md": { enabled: true, actors: ["orchestrator", "bad" as never] },
          "/rules/CLAUDE.md": { enabled: true, actors: [] },
        },
        workspaceControls: {
          " /workspace ": {
            "/workspace/AGENTS.md": { enabled: false, actors: ["handler"] },
          },
        },
      },
      ambientAgentResources: ambientResources({
        skills: { enabled: true },
        commands: { enabled: "yes" },
        unknown: { enabled: true },
      }),
    });

    expect(updated.appPreferences.appAppearance).toBe("system");
    expect(updated.appPreferences.artifactDirectory).toBe("~/.config/svvy/artifacts");
    expect(updated.appPreferences.approvalMode).toBe("auto-review");
    expect(updated.appPreferences.networkAccess).toBe(true);
    expect(updated.appPreferences.externalInstructions.globalRoots).toContainEqual(
      expect.objectContaining({ id: "pi", enabled: false, path: "~/.config/pi" }),
    );
    expect(updated.appPreferences.externalInstructions.globalRoots).toContainEqual(
      expect.objectContaining({ id: "custom-ok", label: "Custom", path: "/custom" }),
    );
    expect(updated.appPreferences.externalInstructions.globalControls).toEqual({
      "/rules/AGENTS.md": { enabled: true, actors: ["orchestrator"] },
      "/rules/CLAUDE.md": { enabled: true, actors: [] },
    });
    expect(updated.appPreferences.externalInstructions.workspaceControls).toEqual({
      "/workspace": {
        "/workspace/AGENTS.md": { enabled: false, actors: ["handler"] },
      },
    });
    expect(updated.appPreferences.ambientAgentResources.categories.skills.enabled).toBe(true);
    expect(updated.appPreferences.ambientAgentResources.categories.commands.enabled).toBe(false);
    expect(updated.appPreferences.ambientAgentResources.categories).not.toHaveProperty("unknown");
    expect(updated.appPreferences.ambientAgentResources.enablements).toEqual([]);
  });

  it("defaults ambient agent resource settings to disabled app-owned categories", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-ambient-settings-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    expect(
      Object.keys(store.getState().appPreferences.ambientAgentResources.categories).toSorted(),
    ).toEqual([...AMBIENT_AGENT_RESOURCE_CATEGORIES].toSorted());
    expect(
      Object.values(store.getState().appPreferences.ambientAgentResources.categories).every(
        (category) => category.enabled === false,
      ),
    ).toBe(true);
    expect(store.getState().appPreferences.ambientAgentResources.enablements).toEqual([]);
  });

  it("normalizes ambient resource enablement records without enabling runtime behavior", () => {
    const root = mkdtempSync(join(tmpdir(), "svvy-ambient-enablements-"));
    const store = createAgentSettingsStore({
      cwd: root,
      agentDir: join(root, ".agent"),
      workflowsSourceRoot: join(root, "workflows"),
    });

    const updated = store.setAppPreferences({
      ...store.getState().appPreferences,
      ambientAgentResources: {
        ...ambientResources({ skills: { enabled: true }, commands: { enabled: true } }),
        enablements: [
          {
            id: " skill-pi ",
            enabled: true,
            host: "pi",
            category: "skills",
            source: { kind: "path", id: " skill-a ", path: " /skills/a " },
            scope: { kind: "workspace", workspaceKey: " workspace:one " },
            targets: [
              { actor: "handler", profileId: " threadHandler " },
              { actor: "bad" as never },
              { actor: "handler", profileId: "threadHandler" },
            ],
          },
          {
            id: "command-codex",
            enabled: "yes" as never,
            host: "codex",
            category: "commands",
            source: { kind: "global", id: "slash-command" },
            scope: { kind: "app" },
            targets: [{ actor: "orchestrator" }],
          },
          {
            id: "bad-host",
            enabled: true,
            host: "unknown" as never,
            category: "skills",
            source: { kind: "path", id: "bad" },
            scope: { kind: "app" },
            targets: [{ actor: "handler" }],
          },
          {
            id: "bad-target",
            enabled: true,
            host: "pi",
            category: "skills",
            source: { kind: "path", id: "bad-target" },
            scope: { kind: "app" },
            targets: [],
          },
        ],
      },
    });

    expect(updated.appPreferences.ambientAgentResources.enablements).toEqual([
      {
        id: "command-codex",
        enabled: false,
        host: "codex",
        category: "commands",
        source: { kind: "global", id: "slash-command" },
        scope: { kind: "app" },
        targets: [{ actor: "orchestrator" }],
      },
      {
        id: "skill-pi",
        enabled: true,
        host: "pi",
        category: "skills",
        source: { kind: "path", id: "skill-a", path: "/skills/a" },
        scope: { kind: "workspace", workspaceKey: "workspace:one" },
        targets: [{ actor: "handler", profileId: "threadHandler" }],
      },
    ]);
  });
});
