import { describe, expect, it } from "bun:test";
import {
  createAgentProfileMutationStore,
  readAgentProfileMutation,
  type AgentProfileAuthoritySnapshot,
} from "./agent-profile-mutation-store";

const snapshot = (): AgentProfileAuthoritySnapshot => ({
  configuredProfiles: [
    {
      profileId: "default-orchestrator" as never,
      actor: "orchestrator",
      name: "Default orchestrator",
      providerId: "zai" as never,
      modelId: "glm-5-turbo" as never,
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: {},
      extensionOrder: ["shell" as never],
      position: 0,
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
      builtin: true,
      locked: true,
      deletable: false,
    },
    {
      profileId: "thread-handler" as never,
      actor: "handler",
      name: "Thread handler",
      providerId: "zai" as never,
      modelId: "glm-5-turbo" as never,
      reasoning: { effort: "medium" },
      followComposer: false,
      extensionUsage: {},
      extensionOrder: [],
      position: 0,
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
      builtin: true,
      locked: true,
      deletable: false,
    },
  ],
  workflowAgents: [
    {
      sourceId: "explorer",
      path: "/tmp/explorer.agent.json" as never,
      sourceVersion: "sha256:explorer-v1",
      fingerprint: "sha256:explorer-v1",
      validationStatus: "valid",
      diagnostics: [],
      parameters: {
        id: "explorer",
        label: "Explorer",
        provider: "zai",
        model: "glm-5-turbo",
        reasoning: { effort: "medium" },
        instructions: "Inspect the repository.",
        overrides: {},
      },
      extensionOrder: ["smithers" as never],
      observedAt: "2026-07-11T00:00:00.000Z" as never,
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
      builtin: true,
      deletable: false,
    },
  ],
  actorExtensionDefaults: [
    {
      actor: "orchestrator",
      extensionUsage: { shell: "loaded" },
      extensionOrder: ["shell" as never],
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
    },
    {
      actor: "workflow-task",
      extensionUsage: { smithers: "available" },
      extensionOrder: ["smithers" as never],
      updatedAt: "2026-07-11T00:00:00.000Z" as never,
    },
  ],
});

describe("agent profile mutation store", () => {
  it("preserves independent actor orders while emitting a full actor-default mutation", () => {
    const store = createAgentProfileMutationStore({ snapshot: snapshot(), networkAccess: true });

    store.setActorExtensionDefaults({
      actor: "workflow-task",
      extensionUsage: { git: "loaded" },
      extensionOrder: ["git"],
    });

    expect(store.getState().actorExtensionDefaults).toEqual({
      orchestrator: {
        extensionUsage: { shell: "loaded" },
        extensionOrder: ["shell"],
      },
      "workflow-task": {
        extensionUsage: { git: "loaded" },
        extensionOrder: ["git"],
      },
    });
    expect(store.takeMutations()).toEqual([
      {
        kind: "actor-extension-defaults.set",
        actor: "workflow-task",
        extensionUsage: { git: "loaded" },
        extensionOrder: ["git"],
      },
    ]);
  });

  it("coalesces repeated workflow edits into one compare-and-swap source save", () => {
    const store = createAgentProfileMutationStore({ snapshot: snapshot(), networkAccess: true });
    const explorer = store.getState().workflowAgents.explorer!;
    store.setWorkflowAgent({
      ...explorer,
      overrides: { shell: "loaded" },
    });
    store.setWorkflowAgent({
      ...store.getState().workflowAgents.explorer!,
      overrides: { shell: "loaded", git: "available" },
    });

    const mutations = store.takeMutations();
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      kind: "workflow-agent-source.save",
      sourceId: "explorer",
      expectedSourceVersion: "sha256:explorer-v1",
    });
    if (mutations[0]?.kind !== "workflow-agent-source.save") {
      throw new Error("Expected a workflow-agent source mutation.");
    }
    expect(JSON.parse(mutations[0].text)).toMatchObject({
      id: "explorer",
      overrides: { shell: "loaded", git: "available" },
      extensionOrder: ["smithers"],
    });
  });

  it("round-trips workflow-agent source upsert intent across the subprocess boundary", () => {
    const store = createAgentProfileMutationStore({ snapshot: snapshot(), networkAccess: true });
    store.upsertWorkflowAgentSource({
      sourceId: "reviewerAgent",
      overwrite: true,
      draft: {
        label: "Reviewer",
        provider: "openai",
        model: "gpt-5.4",
        reasoningEffort: "high",
        instructions: "Review strictly.",
        overrides: { shell: "loaded" },
        extensionOrder: ["shell"],
      },
      text: '{"id":"reviewerAgent"}\n',
      sourceCommandId: "command-1",
    });

    const [mutation] = store.takeMutations();
    if (!mutation) {
      throw new Error("Expected a workflow-agent source upsert mutation.");
    }
    expect(readAgentProfileMutation(structuredClone(mutation))).toEqual(mutation);
    expect(mutation).toMatchObject({
      kind: "workflow-agent-source.upsert",
      sourceId: "reviewerAgent",
      overwrite: true,
      sourceCommandId: "command-1",
    });
  });
});
