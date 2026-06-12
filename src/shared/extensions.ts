import type { SvvyActorKind } from "../bun/actor-capabilities";
import type { GeneratedAgentContextExternalSource } from "./generated-agent-context";

export type ExtensionCategory = "builtin" | "user" | "external_instruction";
export type ExtensionInterfaceKind = "instructions" | "native_tool" | "svvyx";
export type ExtensionUsageState = "default_loaded" | "available" | "unavailable";

export interface ExtensionCliRequirement {
  id: string;
  package?: string;
  binary: string;
  required: boolean;
  version?: string;
  nodeRequirement?: string;
  versionCommand?: string;
  installCommand?: string;
}

export interface ExtensionGeneratedInstruction {
  output: string;
  script: string;
  versionCliRequirementId?: string;
}

export interface ExtensionInstructionFile {
  file: string;
  bypassed: boolean;
}

export interface ExtensionRecord {
  id: string;
  category: ExtensionCategory;
  interface: ExtensionInterfaceKind;
  title: string;
  description: string;
  instructionSourceFiles: string[];
  minimalLoadingHint: string;
  typescriptApiEnabled: boolean;
  envReadiness: "ready" | "not_required" | "missing";
  dependencyReadiness: "ready" | "not_required" | "missing";
  cliRequirements?: readonly ExtensionCliRequirement[];
  generatedInstructions?: readonly ExtensionGeneratedInstruction[];
  instructionFiles?: readonly ExtensionInstructionFile[];
  resetBehavior: "builtin_reset" | "user_reset" | "external_refresh";
  deleteBehavior: "not_allowed" | "trash_allowed";
}

export interface VisibleLoadedExtensionRecord extends ExtensionRecord {
  state: "default_loaded";
}

export interface VisibleAvailableExtensionRecord extends Omit<
  ExtensionRecord,
  "instructionSourceFiles"
> {
  state: "available";
  minimalInstructionPath: string | null;
}

export type VisibleExtensionRecord = VisibleLoadedExtensionRecord | VisibleAvailableExtensionRecord;

type ActorExtensionDefaults = Record<SvvyActorKind, ExtensionUsageState>;

export const BUILTIN_EXTENSIONS = [
  {
    id: "base-common",
    category: "builtin",
    interface: "instructions",
    title: "Base Common",
    description: "Shared svvy operating instructions.",
    instructionSourceFiles: ["src/bun/default-system-prompt.ts"],
    minimalLoadingHint: "Load Base Common only when shared svvy operating rules are missing.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "not_required",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "base-orchestrator",
    category: "builtin",
    interface: "instructions",
    title: "Base Orchestrator",
    description: "Top-level orchestration and delegation instructions.",
    instructionSourceFiles: ["src/bun/default-system-prompt.ts"],
    minimalLoadingHint: "Load Base Orchestrator only for top-level planning and delegation work.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "not_required",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "base-handler",
    category: "builtin",
    interface: "instructions",
    title: "Base Handler",
    description: "Delegated handler-thread instructions.",
    instructionSourceFiles: ["src/bun/default-system-prompt.ts"],
    minimalLoadingHint: "Load Base Handler only for delegated handler-thread work.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "not_required",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "base-workflow-task",
    category: "builtin",
    interface: "instructions",
    title: "Base Workflow Task",
    description: "Workflow task-agent instructions.",
    instructionSourceFiles: ["src/bun/default-system-prompt.ts"],
    minimalLoadingHint: "Load Base Workflow Task only for Smithers workflow task attempts.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "not_required",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "shell",
    category: "builtin",
    interface: "native_tool",
    title: "Shell",
    description: "Command execution through the shared tool pipeline.",
    instructionSourceFiles: ["docs/specs/extension/shell.extension.spec.md"],
    minimalLoadingHint: "Shell is the default command-execution interface.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "apply-patch",
    category: "builtin",
    interface: "native_tool",
    title: "Apply Patch",
    description: "Targeted file patching through the shared tool pipeline.",
    instructionSourceFiles: ["docs/specs/extension/apply_patch.extension.spec.md"],
    minimalLoadingHint: "Apply Patch is the default targeted edit interface.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "execute-typescript",
    category: "builtin",
    interface: "native_tool",
    title: "Execute TypeScript",
    description: "Typed composition snippets with actor-local generated clients.",
    instructionSourceFiles: ["docs/specs/extension/execute_typescript.extension.spec.md"],
    minimalLoadingHint: "Execute TypeScript is available for small typed composition snippets.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "extension-loading",
    category: "builtin",
    interface: "native_tool",
    title: "Extension Loading",
    description: "Actor-local inspection and loading of ready extensions.",
    instructionSourceFiles: ["docs/specs/extensions-and-tools.spec.md"],
    minimalLoadingHint:
      "Use list_extensions and load_extension for actor-local extension visibility.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "extension-managing",
    category: "builtin",
    interface: "native_tool",
    title: "Extension Managing",
    description: "App-owned extension source, build, and inspection controls.",
    instructionSourceFiles: ["docs/specs/extension/extension_managing.extension.spec.md"],
    minimalLoadingHint:
      "Load this extension when app-owned extension source or build inspection is needed.",
    typescriptApiEnabled: false,
    envReadiness: "ready",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "request-user-input",
    category: "builtin",
    interface: "native_tool",
    title: "Request User Input",
    description: "Clarification requests for orchestrators and handler threads.",
    instructionSourceFiles: ["docs/specs/extension/request_user_input.extension.spec.md"],
    minimalLoadingHint:
      "Ask concise user questions when work cannot safely continue from available context.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "thread-orchestration",
    category: "builtin",
    interface: "native_tool",
    title: "Thread Orchestration",
    description: "Orchestrator controls for delegated handler threads.",
    instructionSourceFiles: ["docs/specs/extension/thread_managing.extension.spec.md"],
    minimalLoadingHint:
      "Start, follow up, list, and request reports from delegated handler threads.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "thread-handling",
    category: "builtin",
    interface: "native_tool",
    title: "Thread Handling",
    description: "Handler controls for current thread state and reporting.",
    instructionSourceFiles: ["docs/specs/extension/thread_managing.extension.spec.md"],
    minimalLoadingHint:
      "Inspect current handler state and emit durable reports from handler threads.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "cx",
    category: "builtin",
    interface: "instructions",
    title: "cx",
    description: "Prompt-only semantic code navigation CLI guidance.",
    instructionSourceFiles: ["docs/specs/extension/cx.extension.spec.md"],
    minimalLoadingHint: "Use cx through Shell for semantic code navigation.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    cliRequirements: [
      {
        id: "cx",
        package: "cx-cli",
        binary: "cx",
        required: true,
        version: "0.7.1",
        versionCommand: "cx --version",
        installCommand: "cargo install cx-cli --version {{version}}",
      },
    ],
    generatedInstructions: [
      {
        output: "instructions/full/010-cx-skill.generated.md",
        script: "scripts/generate-cx-skill.ts",
        versionCliRequirementId: "cx",
      },
    ],
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "git",
    category: "builtin",
    interface: "instructions",
    title: "Git",
    description: "Prompt-only Git CLI guidance.",
    instructionSourceFiles: ["docs/specs/extension/git.extension.spec.md"],
    minimalLoadingHint: "Use git through Shell for version-control inspection and changes.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    cliRequirements: [
      {
        id: "git",
        binary: "git",
        required: true,
        versionCommand: "git --version",
      },
    ],
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "github",
    category: "builtin",
    interface: "instructions",
    title: "GitHub",
    description: "Prompt-only GitHub CLI guidance.",
    instructionSourceFiles: ["docs/specs/extension/github.extension.spec.md"],
    minimalLoadingHint:
      "Use gh through Shell for GitHub work when authentication and network policy allow it.",
    typescriptApiEnabled: false,
    envReadiness: "ready",
    dependencyReadiness: "ready",
    cliRequirements: [
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
    ],
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "web",
    category: "builtin",
    interface: "instructions",
    title: "Web",
    description: "Prompt-only TinyFish CLI guidance.",
    instructionSourceFiles: ["docs/specs/extension/web.extension.spec.md"],
    minimalLoadingHint:
      "Use TinyFish through Shell for web research when network access is enabled.",
    typescriptApiEnabled: false,
    envReadiness: "ready",
    dependencyReadiness: "ready",
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
    generatedInstructions: [
      {
        output: "instructions/full/010-tinyfish-cli.generated.md",
        script: "scripts/generate-tinyfish-cli.ts",
        versionCliRequirementId: "tinyfish",
      },
    ],
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "smithers",
    category: "builtin",
    interface: "instructions",
    title: "Smithers",
    description: "Official Smithers CLI and authoring guidance.",
    instructionSourceFiles: [
      "docs/specs/extension/smithers.extension.spec.md",
      "docs/vendor/smithers/smithers-0.22.0.llms-full.txt",
    ],
    minimalLoadingHint:
      "Use official Smithers CLI commands through Shell for workspace .smithers work.",
    typescriptApiEnabled: false,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    cliRequirements: [
      {
        id: "smithers-orchestrator",
        package: "smithers-orchestrator",
        binary: "smithers",
        required: true,
        version: "0.22.0",
        versionCommand: "smithers --version",
        installCommand: "npm install -g smithers-orchestrator@{{version}}",
      },
    ],
    generatedInstructions: [
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
    ],
    instructionFiles: [
      {
        file: "040-smithers-memory.generated.md",
        bypassed: true,
      },
    ],
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "workflows",
    category: "builtin",
    interface: "svvyx",
    title: "Workflows",
    description: "Reusable Smithers workflow authoring assets and generated imports.",
    instructionSourceFiles: ["docs/specs/extension/workflows.extension.spec.md"],
    minimalLoadingHint:
      "Use svvyx workflows only for reusable app-global Workflows source-library operations.",
    typescriptApiEnabled: true,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
  {
    id: "artifacts",
    category: "builtin",
    interface: "svvyx",
    title: "Artifacts",
    description: "Durable session artifact commands.",
    instructionSourceFiles: ["docs/specs/extension/artifacts.extension.spec.md"],
    minimalLoadingHint:
      "Use Artifacts for durable files that should remain inspectable after a turn.",
    typescriptApiEnabled: true,
    envReadiness: "not_required",
    dependencyReadiness: "ready",
    resetBehavior: "builtin_reset",
    deleteBehavior: "not_allowed",
  },
] as const satisfies readonly ExtensionRecord[];

export type BuiltinExtensionId = (typeof BUILTIN_EXTENSIONS)[number]["id"];

export const BUILTIN_EXTENSION_IDS = BUILTIN_EXTENSIONS.map((extension) => extension.id);

export function builtinDefaultExtensionOrder(): string[] {
  return [...BUILTIN_EXTENSION_IDS];
}

const EXTENSION_BY_ID = new Map<string, ExtensionRecord>(
  BUILTIN_EXTENSIONS.map((extension) => [extension.id, extension]),
);

const DEFAULT_STATES: Record<BuiltinExtensionId, ActorExtensionDefaults> = {
  "base-common": all("default_loaded"),
  "base-orchestrator": actorStates("default_loaded", "unavailable", "unavailable"),
  "base-handler": actorStates("unavailable", "default_loaded", "unavailable"),
  "base-workflow-task": actorStates("unavailable", "unavailable", "default_loaded"),
  shell: all("default_loaded"),
  "apply-patch": all("default_loaded"),
  "execute-typescript": all("default_loaded"),
  "extension-loading": all("default_loaded"),
  "extension-managing": actorStates("available", "available", "unavailable"),
  "request-user-input": actorStates("default_loaded", "default_loaded", "unavailable"),
  "thread-orchestration": actorStates("default_loaded", "unavailable", "unavailable"),
  "thread-handling": actorStates("unavailable", "default_loaded", "unavailable"),
  cx: all("default_loaded"),
  git: all("default_loaded"),
  github: actorStates("default_loaded", "default_loaded", "available"),
  web: all("default_loaded"),
  smithers: actorStates("available", "default_loaded", "unavailable"),
  workflows: actorStates("available", "default_loaded", "unavailable"),
  artifacts: all("default_loaded"),
};

export function getExtensionRecord(id: string): ExtensionRecord | null {
  return EXTENSION_BY_ID.get(id) ?? null;
}

export function resolveActorExtensionState(input: {
  actor: SvvyActorKind;
  defaultExtensionOrder?: readonly string[] | null;
  defaultExtensionUsage?: Partial<
    Record<SvvyActorKind, Record<string, ExtensionUsageState>>
  > | null;
  profileExtensionUsage?: Record<string, ExtensionUsageState> | null;
  profileLoadedExtensionIds?: readonly string[];
  profileExtensionOrder?: readonly string[];
  overrides?: Record<string, ExtensionUsageState> | null;
  networkAccess?: boolean;
}): { loadedExtensionIds: string[]; availableExtensionIds: string[] } {
  const states = new Map<string, ExtensionUsageState>();
  for (const extension of BUILTIN_EXTENSIONS) {
    states.set(extension.id, getDefaultUsageState(extension.id, input.actor, input.networkAccess));
  }
  if (input.actor !== "handler") {
    for (const [rawId, state] of Object.entries(input.defaultExtensionUsage?.[input.actor] ?? {})) {
      const id = rawId.trim();
      if (!id || id === "extension-loading") continue;
      states.set(id, state);
    }
  }
  for (const rawId of input.profileLoadedExtensionIds ?? []) {
    const id = rawId.trim();
    if (!id) continue;
    if (!EXTENSION_BY_ID.has(id)) {
      states.set(id, "default_loaded");
    } else if (states.get(id) !== "unavailable") {
      states.set(id, "default_loaded");
    }
  }
  for (const [rawId, state] of Object.entries(input.profileExtensionUsage ?? {})) {
    const id = rawId.trim();
    if (!id) continue;
    if (!EXTENSION_BY_ID.has(id)) {
      if (state !== "unavailable") {
        states.set(id, state);
      }
      continue;
    }
    const defaultState = getDefaultUsageState(id, input.actor, input.networkAccess);
    if (defaultState === "unavailable" && state !== "unavailable") {
      continue;
    }
    states.set(id, state);
  }
  for (const [rawId, state] of Object.entries(input.overrides ?? {})) {
    const id = rawId.trim();
    if (!id) continue;
    if (!EXTENSION_BY_ID.has(id)) {
      if (state !== "unavailable") {
        states.set(id, state);
      }
      continue;
    }
    if (id === "extension-loading") continue;
    const defaultState = getDefaultUsageState(id, input.actor, input.networkAccess);
    if (defaultState === "unavailable" && state !== "unavailable") {
      continue;
    }
    states.set(id, state);
  }
  states.set("extension-loading", "default_loaded");
  const extensionOrder =
    input.profileExtensionOrder && input.profileExtensionOrder.length > 0
      ? input.profileExtensionOrder
      : input.actor === "handler"
        ? []
        : (input.defaultExtensionOrder ?? []);
  return {
    loadedExtensionIds: sortedIdsWithState(states, "default_loaded", extensionOrder),
    availableExtensionIds: sortedIdsWithState(states, "available", extensionOrder),
  };
}

export function visibleExtensionRecords(input: {
  actor?: SvvyActorKind;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  loadedExtensionRecords?: readonly ExtensionRecord[];
  availableExtensionRecords?: readonly ExtensionRecord[];
  externalInstructionSources?: readonly GeneratedAgentContextExternalSource[];
}): { loaded: VisibleLoadedExtensionRecord[]; available: VisibleAvailableExtensionRecord[] } {
  const loadedRecords = new Map(
    (input.loadedExtensionRecords ?? []).map((record) => [record.id, record]),
  );
  const availableRecords = new Map(
    (input.availableExtensionRecords ?? []).map((record) => [record.id, record]),
  );
  const externalInstructions = externalInstructionRecords(
    input.externalInstructionSources ?? [],
    input.actor,
  );
  return {
    loaded: [
      ...input.loadedExtensionIds.flatMap((id) => loadedVisibleRecord(id, loadedRecords)),
      ...externalInstructions.loaded,
    ],
    available: [
      ...input.availableExtensionIds.flatMap((id) => availableVisibleRecord(id, availableRecords)),
      ...externalInstructions.available,
    ],
  };
}

export function externalInstructionExtensionId(
  source: GeneratedAgentContextExternalSource,
): string {
  return `external_instruction:${source.kind}:${source.path.replaceAll("\\", "/")}`;
}

function getDefaultUsageState(
  id: string,
  actor: SvvyActorKind,
  networkAccess = true,
): ExtensionUsageState {
  if (id === "web" && !networkAccess) {
    return "unavailable";
  }
  return DEFAULT_STATES[id as BuiltinExtensionId]?.[actor] ?? "unavailable";
}

export function builtinDefaultExtensionUsageState(
  id: string,
  actor: SvvyActorKind,
  networkAccess = true,
): ExtensionUsageState {
  return getDefaultUsageState(id, actor, networkAccess);
}

function loadedVisibleRecord(
  id: string,
  extensionRecords: ReadonlyMap<string, ExtensionRecord> = new Map(),
): VisibleLoadedExtensionRecord[] {
  const record = extensionRecords.get(id) ?? getExtensionRecord(id);
  return record ? [{ ...publicExtensionRecord(record), state: "default_loaded" }] : [];
}

function availableVisibleRecord(
  id: string,
  extensionRecords: ReadonlyMap<string, ExtensionRecord> = new Map(),
): VisibleAvailableExtensionRecord[] {
  const record = extensionRecords.get(id) ?? getExtensionRecord(id);
  if (!record) {
    return [];
  }
  const { instructionSourceFiles: _instructionSourceFiles, ...available } =
    publicExtensionRecord(record);
  return [{ ...available, minimalInstructionPath: null, state: "available" }];
}

function publicExtensionRecord(record: ExtensionRecord): ExtensionRecord {
  return {
    id: record.id,
    category: record.category,
    interface: record.interface,
    title: record.title,
    description: record.description,
    instructionSourceFiles: [...record.instructionSourceFiles],
    minimalLoadingHint: record.minimalLoadingHint,
    typescriptApiEnabled: record.typescriptApiEnabled,
    envReadiness: record.envReadiness,
    dependencyReadiness: record.dependencyReadiness,
    ...(record.cliRequirements ? { cliRequirements: record.cliRequirements } : {}),
    ...(record.generatedInstructions
      ? { generatedInstructions: record.generatedInstructions }
      : {}),
    ...(record.instructionFiles ? { instructionFiles: record.instructionFiles } : {}),
    resetBehavior: record.resetBehavior,
    deleteBehavior: record.deleteBehavior,
  };
}

function externalInstructionRecords(
  sources: readonly GeneratedAgentContextExternalSource[],
  actor?: SvvyActorKind,
): { loaded: VisibleLoadedExtensionRecord[]; available: VisibleAvailableExtensionRecord[] } {
  const loaded: VisibleLoadedExtensionRecord[] = [];
  const available: VisibleAvailableExtensionRecord[] = [];
  for (const source of sources) {
    const normalizedPath = source.path.replaceAll("\\", "/");
    const record: ExtensionRecord = {
      id: externalInstructionExtensionId(source),
      category: "external_instruction",
      interface: "instructions",
      title: source.title,
      description: `Read-only ${source.kind} external instruction file.`,
      instructionSourceFiles: [normalizedPath],
      minimalLoadingHint:
        "External instruction files are loaded read-only when enabled for this actor.",
      typescriptApiEnabled: false,
      envReadiness: "not_required",
      dependencyReadiness: "not_required",
      resetBehavior: "external_refresh",
      deleteBehavior: "not_allowed",
    };
    if (
      source.enabled &&
      source.readStatus.status === "readable" &&
      (!actor || source.actors.includes(actor))
    ) {
      loaded.push({ ...record, state: "default_loaded" });
    }
  }
  return { loaded, available };
}

function sortedIdsWithState(
  states: ReadonlyMap<string, ExtensionUsageState>,
  state: ExtensionUsageState,
  extensionOrder: readonly string[] = [],
): string[] {
  const orderById = new Map(extensionOrder.map((id, index) => [id, index]));
  const defaultOrderById = new Map<string, number>(
    BUILTIN_EXTENSION_IDS.map((id, index) => [id, index]),
  );
  return [...states.entries()]
    .filter((entry): entry is [string, ExtensionUsageState] => entry[1] === state)
    .map(([id]) => id)
    .toSorted((left, right) => {
      const leftOrder = orderById.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderById.get(right) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      const leftDefaultOrder = defaultOrderById.get(left) ?? Number.MAX_SAFE_INTEGER;
      const rightDefaultOrder = defaultOrderById.get(right) ?? Number.MAX_SAFE_INTEGER;
      return leftDefaultOrder - rightDefaultOrder || left.localeCompare(right);
    });
}

function actorStates(
  orchestrator: ExtensionUsageState,
  handler: ExtensionUsageState,
  workflowTask: ExtensionUsageState,
): ActorExtensionDefaults {
  return { orchestrator, handler, "workflow-task": workflowTask };
}

function all(state: ExtensionUsageState): ActorExtensionDefaults {
  return actorStates(state, state, state);
}
