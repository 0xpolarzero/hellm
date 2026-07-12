import {
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  type ExtensionUsageState,
  type ExternalInstructionActor,
  type ExternalInstructionsSettings,
} from "@svvy/core";

export {
  DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
  DEFAULT_EXTERNAL_INSTRUCTION_GLOBAL_ROOTS,
  DEFAULT_EXTERNAL_INSTRUCTIONS,
  normalizeExternalInstructionsSettings,
} from "@svvy/core";
export type {
  ExternalInstructionActor,
  ExternalInstructionControl,
  ExternalInstructionGlobalRootKind,
  ExternalInstructionGlobalRootSetting,
  ExternalInstructionsSettings,
} from "@svvy/core";

export type ReasoningEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type AgentProfileKind = "orchestrator" | "special";
export type AgentProfileSpecialKey = "threadHandler";
export type AgentProfileId = string;
export type WorkflowAgentKey = string;
export type AppAppearance = "system" | "light" | "dark";
export type PreferredExternalEditor = "system" | "code" | "cursor" | "zed" | "sublime" | "custom";
export type ApprovalMode = "auto-review" | "user" | "full-access";
export type AmbientAgentResourceHost = "pi" | "codex" | "claude" | "other";
export type AmbientAgentResourceCategory =
  | "callableCapabilities"
  | "runtimeExtensionsAndPackages"
  | "skills"
  | "promptTemplates"
  | "commands"
  | "hooks"
  | "uiResources"
  | "providerModelAdapters"
  | "credentials"
  | "executionPolicy"
  | "runtimeState";

export interface AgentDefaults {
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
}

export interface AgentPromptSettings extends AgentDefaults {
  systemPrompt: string;
}

export interface AgentProfileSettings extends AgentDefaults {
  id: AgentProfileId;
  kind: AgentProfileKind;
  name: string;
  systemPrompt: string;
  extensionUsage: Record<string, ExtensionUsageState>;
  extensionOrder?: string[];
  updateFromComposer: boolean;
  builtin: boolean;
  locked: boolean;
}

export interface InternalAgentSettings {
  titleNamer: AgentPromptSettings;
}

export interface WorkflowAgentSettings {
  id: string;
  label: string;
  provider: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  instructions: string;
  overrides?: Record<string, ExtensionUsageState>;
  extensionOrder?: string[];
  sourceVersion?: string;
}

export interface AgentSettingsState {
  version: 3;
  agents: InternalAgentSettings;
  extensionEnv: ExtensionEnvSettings;
  appPreferences: AppPreferences;
}

export interface ExtensionDefaultsSettings {
  order: string[];
  usage: Partial<Record<ExternalInstructionActor, Record<string, ExtensionUsageState>>>;
}

export type ExtensionEnvValues = Record<string, Record<string, string>>;

export interface ExtensionEnvSettings {
  nonSecretOverrides: ExtensionEnvValues;
}

export interface AppPreferences {
  appAppearance: AppAppearance;
  preferredExternalEditor: PreferredExternalEditor;
  customExternalEditorCommand: string;
  artifactDirectory: string;
  approvalMode: ApprovalMode;
  networkAccess: boolean;
  externalInstructions: ExternalInstructionsSettings;
  ambientAgentResources: AmbientAgentResourcesSettings;
}

export const DEFAULT_ARTIFACT_DIRECTORY = "~/.config/svvy/artifacts";

export interface AmbientAgentResourceCategorySetting {
  enabled: boolean;
}

export interface AmbientAgentResourceSource {
  kind: "global" | "workspace" | "path" | "package";
  id: string;
  path?: string;
}

export type AmbientAgentResourceScope =
  | { kind: "app" }
  | { kind: "workspace"; workspaceKey: string };

export interface AmbientAgentResourceTarget {
  actor: ExternalInstructionActor;
  profileId?: string;
}

export interface AmbientAgentResourceEnablementRecord {
  id: string;
  enabled: boolean;
  host: AmbientAgentResourceHost;
  category: AmbientAgentResourceCategory;
  source: AmbientAgentResourceSource;
  scope: AmbientAgentResourceScope;
  targets: AmbientAgentResourceTarget[];
}

export interface AmbientAgentResourcesSettings {
  categories: Record<AmbientAgentResourceCategory, AmbientAgentResourceCategorySetting>;
  enablements: AmbientAgentResourceEnablementRecord[];
}

export const AMBIENT_AGENT_RESOURCE_CATEGORIES = [
  "callableCapabilities",
  "runtimeExtensionsAndPackages",
  "skills",
  "promptTemplates",
  "commands",
  "hooks",
  "uiResources",
  "providerModelAdapters",
  "credentials",
  "executionPolicy",
  "runtimeState",
] as const satisfies readonly AmbientAgentResourceCategory[];

export const DEFAULT_AMBIENT_AGENT_RESOURCES = {
  categories: Object.fromEntries(
    AMBIENT_AGENT_RESOURCE_CATEGORIES.map((category) => [category, { enabled: false }]),
  ) as Record<AmbientAgentResourceCategory, AmbientAgentResourceCategorySetting>,
  enablements: [],
} satisfies AmbientAgentResourcesSettings;

export const DEFAULT_AGENT_SETTINGS = {
  provider: "zai",
  model: "glm-5-turbo",
  reasoningEffort: "medium",
} satisfies AgentDefaults;

export const DEFAULT_ORCHESTRATOR_PROFILE_ID = "default-orchestrator";
export const DEFAULT_THREAD_HANDLER_PROFILE_ID = "thread-handler";

export const DEFAULT_ORCHESTRATOR_SESSION_PROMPT = "";

export const DEFAULT_THREAD_HANDLER_PROMPT = "";

export const DEFAULT_NAMER_SESSION_PROMPT = [
  "You generate concise session titles for svvy.",
  "Return exactly one title and nothing else.",
  "",
  "The prompt you receive is formatted as:",
  "First user message:",
  "<the user's first message>",
  "",
  "Rules:",
  "- Title only the message after the label.",
  "- Use 2 to 6 words and stay at or below 50 characters.",
  "- Describe the user's concrete intent with specific nouns and verbs from the message.",
  "- Distill the message; do not copy the whole first message as the title.",
  "- Preserve important product names, acronyms, and proper nouns.",
  "- For greetings or vague openers, name the interaction intent, for example Greeting and help request.",
  "- Never return generic titles such as New, New Session, Session, Chat, Conversation, Request, or Task.",
  "- Do not use quotes, colons, markdown, bullets, trailing punctuation, or explanations.",
  "- Use sentence case unless preserving acronyms or proper nouns.",
  "",
  "Examples:",
  "First user message: Hi there",
  "Greeting and help request",
  "",
  "First user message: Implement the Dockview workspace layout integration",
  "Dockview workspace layout",
  "",
  "First user message: The app is duplicating assistant messages after streaming finishes, fix it",
  "Assistant streaming duplicates",
].join("\n");

export const DEFAULT_INTERNAL_AGENT_SETTINGS = {
  titleNamer: {
    ...DEFAULT_AGENT_SETTINGS,
    provider: "openai-codex",
    model: "gpt-5.4-mini",
    reasoningEffort: "low",
    systemPrompt: DEFAULT_NAMER_SESSION_PROMPT,
  },
} satisfies InternalAgentSettings;

export const DEFAULT_AGENT_SETTINGS_STATE = {
  version: 3,
  agents: DEFAULT_INTERNAL_AGENT_SETTINGS,
  extensionEnv: {
    nonSecretOverrides: {},
  },
  appPreferences: {
    appAppearance: "system",
    preferredExternalEditor: "system",
    customExternalEditorCommand: "",
    artifactDirectory: DEFAULT_ARTIFACT_DIRECTORY,
    approvalMode: "auto-review",
    networkAccess: true,
    externalInstructions: DEFAULT_EXTERNAL_INSTRUCTIONS,
    ambientAgentResources: DEFAULT_AMBIENT_AGENT_RESOURCES,
  },
} satisfies AgentSettingsState;
