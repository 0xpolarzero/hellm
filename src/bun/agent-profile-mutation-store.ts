import type { ExtensionUsageState } from "@svvy/core";
import type {
  AgentActorExtensionDefaultsReadModelRecord,
  ConfiguredAgentProfileReadModelRecord,
  WorkflowAgentSourceReadModelRecord,
} from "@svvy/state";
import {
  type AgentProfileSettings,
  type ExtensionDefaultsSettings,
  type WorkflowAgentSettings,
} from "../shared/agent-settings";

export interface AgentProfileAuthoritySnapshot {
  readonly configuredProfiles: readonly ConfiguredAgentProfileReadModelRecord[];
  readonly workflowAgents: readonly WorkflowAgentSourceReadModelRecord[];
  readonly actorExtensionDefaults: readonly AgentActorExtensionDefaultsReadModelRecord[];
}

export interface WorkflowAgentSourceUpsertDraft {
  readonly label: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort: WorkflowAgentSettings["reasoningEffort"];
  readonly instructions: string;
  readonly overrides: Readonly<Record<string, ExtensionUsageState>>;
  readonly extensionOrder: readonly string[];
}

export type AgentProfileMutation =
  | {
      readonly kind: "profile-extension-usage.set";
      readonly actor: "orchestrator" | "handler";
      readonly profileId: string;
      readonly extensionId: string;
      readonly usage: ExtensionUsageState;
    }
  | {
      readonly kind: "actor-extension-defaults.set";
      readonly actor: "orchestrator" | "workflow-task";
      readonly extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
      readonly extensionOrder: readonly string[];
    }
  | {
      readonly kind: "workflow-agent-source.save";
      readonly sourceId: string;
      readonly expectedSourceVersion: string;
      readonly text: string;
    }
  | {
      readonly kind: "workflow-agent-source.upsert";
      readonly sourceId: string;
      readonly overwrite: boolean;
      readonly draft: WorkflowAgentSourceUpsertDraft;
      readonly text: string;
      readonly sourceCommandId?: string;
    };

export interface AgentProfileMutationStoreState {
  readonly agents: {
    readonly orchestrators: readonly AgentProfileSettings[];
    readonly special: { readonly threadHandler: AgentProfileSettings };
  };
  readonly workflowAgents: Readonly<Record<string, WorkflowAgentSettings>>;
  readonly actorExtensionDefaults: Readonly<
    Record<
      "orchestrator" | "workflow-task",
      {
        readonly extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
        readonly extensionOrder: readonly string[];
      }
    >
  >;
  readonly extensionDefaults: ExtensionDefaultsSettings;
  readonly appPreferences: { readonly networkAccess: boolean };
}

export interface AgentProfileMutationStore {
  getState(): AgentProfileMutationStoreState;
  setProfileExtensionUsage(input: {
    actor: "orchestrator" | "handler";
    profileId: string;
    extensionId: string;
    usage: ExtensionUsageState;
    explicit: boolean;
  }): AgentProfileMutationStoreState;
  setWorkflowAgent(settings: WorkflowAgentSettings): AgentProfileMutationStoreState;
  upsertWorkflowAgentSource(input: {
    readonly sourceId: string;
    readonly overwrite: boolean;
    readonly draft: WorkflowAgentSourceUpsertDraft;
    readonly text: string;
    readonly sourceCommandId?: string;
  }): AgentProfileMutationStoreState;
  setActorExtensionDefaults(input: {
    actor: "orchestrator" | "workflow-task";
    extensionUsage: Readonly<Record<string, ExtensionUsageState>>;
    extensionOrder: readonly string[];
  }): AgentProfileMutationStoreState;
  takeMutations(): readonly AgentProfileMutation[];
}

export function createAgentProfileMutationStore(input: {
  snapshot: AgentProfileAuthoritySnapshot;
  networkAccess: boolean;
}): AgentProfileMutationStore {
  let state = stateFromSnapshot(input.snapshot, input.networkAccess);
  const mutations: AgentProfileMutation[] = [];

  return {
    getState: () => structuredClone(state),
    setProfileExtensionUsage: (mutation) => {
      const apply = (profile: AgentProfileSettings): AgentProfileSettings => {
        if (profile.id !== mutation.profileId) return profile;
        const extensionUsage = { ...profile.extensionUsage };
        if (mutation.explicit) {
          extensionUsage[mutation.extensionId] = mutation.usage;
        } else {
          delete extensionUsage[mutation.extensionId];
        }
        return { ...profile, extensionUsage };
      };
      state = {
        ...state,
        agents: {
          orchestrators:
            mutation.actor === "orchestrator"
              ? state.agents.orchestrators.map(apply)
              : state.agents.orchestrators,
          special: {
            threadHandler:
              mutation.actor === "handler"
                ? apply(state.agents.special.threadHandler)
                : state.agents.special.threadHandler,
          },
        },
      };
      mutations.push({
        kind: "profile-extension-usage.set",
        actor: mutation.actor,
        profileId: mutation.profileId,
        extensionId: mutation.extensionId,
        usage: mutation.usage,
      });
      return structuredClone(state);
    },
    setWorkflowAgent: (settings) => {
      if (!settings.sourceVersion) {
        throw new Error(`Workflow agent ${settings.id} has no authoritative source version.`);
      }
      state = {
        ...state,
        workflowAgents: { ...state.workflowAgents, [settings.id]: structuredClone(settings) },
      };
      const nextMutation: AgentProfileMutation = {
        kind: "workflow-agent-source.save",
        sourceId: settings.id,
        expectedSourceVersion: settings.sourceVersion,
        text: workflowAgentSourceText(settings),
      };
      const pendingIndex = mutations.findIndex(
        (mutation) =>
          mutation.kind === "workflow-agent-source.save" && mutation.sourceId === settings.id,
      );
      if (pendingIndex >= 0) {
        const pending = mutations[pendingIndex]!;
        mutations[pendingIndex] = {
          ...nextMutation,
          expectedSourceVersion:
            pending.kind === "workflow-agent-source.save"
              ? pending.expectedSourceVersion
              : nextMutation.expectedSourceVersion,
        };
      } else {
        mutations.push(nextMutation);
      }
      return structuredClone(state);
    },
    upsertWorkflowAgentSource: (mutation) => {
      mutations.push({
        kind: "workflow-agent-source.upsert",
        sourceId: mutation.sourceId,
        overwrite: mutation.overwrite,
        draft: structuredClone(mutation.draft),
        text: mutation.text,
        ...(mutation.sourceCommandId ? { sourceCommandId: mutation.sourceCommandId } : {}),
      });
      return structuredClone(state);
    },
    setActorExtensionDefaults: (mutation) => {
      const extensionDefaults = structuredClone(state.extensionDefaults);
      extensionDefaults.usage[mutation.actor] = { ...mutation.extensionUsage };
      if (mutation.actor === "orchestrator") {
        extensionDefaults.order = [...mutation.extensionOrder];
      }
      state = {
        ...state,
        actorExtensionDefaults: {
          ...state.actorExtensionDefaults,
          [mutation.actor]: {
            extensionUsage: { ...mutation.extensionUsage },
            extensionOrder: [...mutation.extensionOrder],
          },
        },
        extensionDefaults,
      };
      mutations.push({
        kind: "actor-extension-defaults.set",
        actor: mutation.actor,
        extensionUsage: { ...mutation.extensionUsage },
        extensionOrder: [...mutation.extensionOrder],
      });
      return structuredClone(state);
    },
    takeMutations: () => structuredClone(mutations),
  };
}

export function readAgentProfileMutation(value: unknown): AgentProfileMutation | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    input.kind === "profile-extension-usage.set" &&
    (input.actor === "orchestrator" || input.actor === "handler") &&
    typeof input.profileId === "string" &&
    typeof input.extensionId === "string" &&
    isExtensionUsageState(input.usage)
  ) {
    return {
      kind: input.kind,
      actor: input.actor,
      profileId: input.profileId,
      extensionId: input.extensionId,
      usage: input.usage,
    };
  }
  if (
    input.kind === "actor-extension-defaults.set" &&
    (input.actor === "orchestrator" || input.actor === "workflow-task") &&
    isExtensionUsageRecord(input.extensionUsage) &&
    isStringArray(input.extensionOrder)
  ) {
    return {
      kind: input.kind,
      actor: input.actor,
      extensionUsage: input.extensionUsage,
      extensionOrder: input.extensionOrder,
    };
  }
  if (
    input.kind === "workflow-agent-source.save" &&
    typeof input.sourceId === "string" &&
    typeof input.expectedSourceVersion === "string" &&
    typeof input.text === "string"
  ) {
    return {
      kind: input.kind,
      sourceId: input.sourceId,
      expectedSourceVersion: input.expectedSourceVersion,
      text: input.text,
    };
  }
  if (
    input.kind === "workflow-agent-source.upsert" &&
    typeof input.sourceId === "string" &&
    typeof input.overwrite === "boolean" &&
    isWorkflowAgentSourceUpsertDraft(input.draft) &&
    typeof input.text === "string" &&
    (input.sourceCommandId === undefined || typeof input.sourceCommandId === "string")
  ) {
    return {
      kind: input.kind,
      sourceId: input.sourceId,
      overwrite: input.overwrite,
      draft: input.draft,
      text: input.text,
      ...(input.sourceCommandId ? { sourceCommandId: input.sourceCommandId } : {}),
    };
  }
  return null;
}

function stateFromSnapshot(
  snapshot: AgentProfileAuthoritySnapshot,
  networkAccess: boolean,
): AgentProfileMutationStoreState {
  const profiles = snapshot.configuredProfiles.map(configuredProfileSettings);
  const threadHandler = profiles.find((profile) => profile.kind === "special");
  if (!threadHandler) {
    throw new Error("Agent profile authority snapshot is missing the thread-handler profile.");
  }
  const workflowAgents = Object.fromEntries(
    snapshot.workflowAgents.flatMap((record) => {
      if (record.validationStatus !== "valid" || !record.parameters) return [];
      return [
        [
          record.sourceId,
          {
            id: record.sourceId,
            label: record.parameters.label,
            provider: record.parameters.provider,
            model: record.parameters.model,
            reasoningEffort: record.parameters.reasoning.effort,
            instructions: record.parameters.instructions,
            overrides: { ...record.parameters.overrides },
            extensionOrder: [...record.extensionOrder],
            sourceVersion: record.sourceVersion,
          } satisfies WorkflowAgentSettings,
        ],
      ];
    }),
  );
  const actorDefaults = Object.fromEntries(
    snapshot.actorExtensionDefaults.map((record) => [record.actor, record]),
  );
  const orchestratorDefaults = actorDefaults.orchestrator;
  const workflowTaskDefaults = actorDefaults["workflow-task"];
  if (!orchestratorDefaults || !workflowTaskDefaults) {
    throw new Error("Agent profile authority snapshot is missing actor extension defaults.");
  }
  return {
    agents: {
      orchestrators: profiles.filter((profile) => profile.kind === "orchestrator"),
      special: { threadHandler },
    },
    workflowAgents,
    actorExtensionDefaults: {
      orchestrator: {
        extensionUsage: { ...orchestratorDefaults.extensionUsage },
        extensionOrder: [...orchestratorDefaults.extensionOrder],
      },
      "workflow-task": {
        extensionUsage: { ...workflowTaskDefaults.extensionUsage },
        extensionOrder: [...workflowTaskDefaults.extensionOrder],
      },
    },
    extensionDefaults: {
      order: [...orchestratorDefaults.extensionOrder],
      usage: {
        orchestrator: { ...orchestratorDefaults.extensionUsage },
        "workflow-task": { ...workflowTaskDefaults.extensionUsage },
      },
    },
    appPreferences: { networkAccess },
  };
}

function configuredProfileSettings(
  profile: ConfiguredAgentProfileReadModelRecord,
): AgentProfileSettings {
  return {
    id: profile.profileId,
    kind: profile.actor === "handler" ? "special" : "orchestrator",
    name: profile.name,
    provider: profile.providerId,
    model: profile.modelId,
    reasoningEffort: readReasoningEffort(profile.reasoning),
    systemPrompt: "",
    extensionUsage: { ...profile.extensionUsage },
    extensionOrder: [...profile.extensionOrder],
    updateFromComposer: profile.followComposer,
    builtin: profile.builtin,
    locked: profile.locked,
  };
}

function workflowAgentSourceText(agent: WorkflowAgentSettings): string {
  return `${JSON.stringify(
    {
      id: agent.id,
      label: agent.label,
      provider: agent.provider,
      model: agent.model,
      reasoning: { effort: agent.reasoningEffort },
      instructions: agent.instructions,
      overrides: agent.overrides ?? {},
      extensionOrder: agent.extensionOrder ?? [],
    },
    null,
    2,
  )}\n`;
}

function readReasoningEffort(value: unknown): AgentProfileSettings["reasoningEffort"] {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const effort = (value as { effort?: unknown }).effort;
    if (
      effort === "off" ||
      effort === "minimal" ||
      effort === "low" ||
      effort === "medium" ||
      effort === "high" ||
      effort === "xhigh"
    ) {
      return effort;
    }
  }
  return "medium";
}

function isExtensionUsageState(value: unknown): value is ExtensionUsageState {
  return value === "loaded" || value === "available" || value === "unavailable";
}

function isExtensionUsageRecord(value: unknown): value is Record<string, ExtensionUsageState> {
  return (
    Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
    Object.values(value as Record<string, unknown>).every(isExtensionUsageState)
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkflowAgentSourceUpsertDraft(value: unknown): value is WorkflowAgentSourceUpsertDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.label === "string" &&
    typeof draft.provider === "string" &&
    typeof draft.model === "string" &&
    isReasoningEffort(draft.reasoningEffort) &&
    typeof draft.instructions === "string" &&
    isExtensionUsageRecord(draft.overrides) &&
    isStringArray(draft.extensionOrder)
  );
}

function isReasoningEffort(value: unknown): value is WorkflowAgentSettings["reasoningEffort"] {
  return (
    value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}
