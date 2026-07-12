import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_AGENT_SETTINGS_STATE } from "../shared/agent-settings";
import { createAgentSettingsStore } from "./agent-settings-store";

describe("agent settings store", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  function createStore() {
    const agentDir = mkdtempSync(join(tmpdir(), "svvy-agent-settings-"));
    tempDirs.push(agentDir);
    return { agentDir, store: createAgentSettingsStore({ agentDir }) };
  }

  it("contains only internal title-namer, env, and app-preference settings", () => {
    const { store } = createStore();
    const state = store.getState();

    expect(state).toEqual(DEFAULT_AGENT_SETTINGS_STATE);
    expect(Object.keys(state).toSorted()).toEqual([
      "agents",
      "appPreferences",
      "extensionEnv",
      "version",
    ]);
    expect(Object.keys(state.agents)).toEqual(["titleNamer"]);
    expect("workflowAgents" in state).toBe(false);
    expect("extensionDefaults" in state).toBe(false);
    expect("setAgentProfile" in store).toBe(false);
    expect("setWorkflowAgent" in store).toBe(false);
    expect("deleteWorkflowAgent" in store).toBe(false);
  });

  it("drops obsolete visible-agent fields when current settings are persisted", () => {
    const { agentDir, store } = createStore();
    const settingsPath = join(agentDir, "agent-settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 2,
        agents: {
          orchestrators: [{ id: "obsolete-orchestrator" }],
          special: { threadHandler: { id: "obsolete-handler" } },
          titleNamer: DEFAULT_AGENT_SETTINGS_STATE.agents.titleNamer,
        },
        workflowAgents: { obsoleteAgent: { id: "obsoleteAgent" } },
        extensionDefaults: { order: ["obsolete"], usage: {} },
        extensionEnv: { nonSecretOverrides: {} },
        appPreferences: DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
      }),
    );

    const state = store.setExtensionEnv({
      nonSecretOverrides: { shell: { PAGER: "cat" } },
    });
    const persisted = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;

    expect(state.agents).toEqual({ titleNamer: DEFAULT_AGENT_SETTINGS_STATE.agents.titleNamer });
    expect(persisted).not.toHaveProperty("workflowAgents");
    expect(persisted).not.toHaveProperty("extensionDefaults");
    expect(persisted.agents).toEqual({
      titleNamer: DEFAULT_AGENT_SETTINGS_STATE.agents.titleNamer,
    });
  });

  it("persists app-global non-secret extension env overrides", () => {
    const { agentDir, store } = createStore();
    store.setExtensionEnv({
      nonSecretOverrides: {
        shell: { PAGER: "cat", EMPTY: "" },
        "  git  ": { " GIT_PAGER ": "less" },
      },
    });

    const reopened = createAgentSettingsStore({ agentDir });
    expect(reopened.getState().extensionEnv).toEqual({
      nonSecretOverrides: {
        shell: { PAGER: "cat", EMPTY: "" },
        git: { GIT_PAGER: "less" },
      },
    });
  });

  it("hydrates state-owned app preferences without rewriting the file-backed seed", () => {
    const { agentDir, store } = createStore();
    const settingsPath = join(agentDir, "agent-settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        ...DEFAULT_AGENT_SETTINGS_STATE,
        appPreferences: {
          ...DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
          appAppearance: "dark",
          preferredExternalEditor: "code",
          approvalMode: "user",
          networkAccess: false,
        },
      }),
    );
    const overlay = store.hydrateStateOwnedAppPreferences({
      ...DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
      appAppearance: "light",
      preferredExternalEditor: "zed",
      approvalMode: "full-access",
      networkAccess: true,
    });

    expect(overlay.appPreferences).toMatchObject({
      appAppearance: "light",
      preferredExternalEditor: "zed",
      approvalMode: "full-access",
      networkAccess: true,
    });
    expect(JSON.parse(readFileSync(settingsPath, "utf8")).appPreferences).toMatchObject({
      appAppearance: "dark",
      preferredExternalEditor: "code",
      approvalMode: "user",
      networkAccess: false,
    });
  });

  it("normalizes ambient resource enablement without enabling unspecified categories", () => {
    const { store } = createStore();
    const state = store.hydrateStateOwnedAppPreferences({
      ...DEFAULT_AGENT_SETTINGS_STATE.appPreferences,
      ambientAgentResources: {
        categories: {
          ...DEFAULT_AGENT_SETTINGS_STATE.appPreferences.ambientAgentResources.categories,
          skills: { enabled: true },
        },
        enablements: [
          {
            id: "workspace-skills",
            enabled: true,
            host: "pi",
            category: "skills",
            source: { kind: "workspace", id: "skills", path: " /tmp/skills " },
            scope: { kind: "workspace", workspaceKey: " workspace-a " },
            targets: [{ actor: "orchestrator", profileId: " default-orchestrator " }],
          },
        ],
      },
    });

    expect(state.appPreferences.ambientAgentResources.categories.skills.enabled).toBe(true);
    expect(state.appPreferences.ambientAgentResources.categories.callableCapabilities.enabled).toBe(
      false,
    );
    expect(state.appPreferences.ambientAgentResources.enablements).toEqual([
      {
        id: "workspace-skills",
        enabled: true,
        host: "pi",
        category: "skills",
        source: { kind: "workspace", id: "skills", path: "/tmp/skills" },
        scope: { kind: "workspace", workspaceKey: "workspace-a" },
        targets: [{ actor: "orchestrator", profileId: "default-orchestrator" }],
      },
    ]);
  });
});
