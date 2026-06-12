import type { ExternalInstructionActor } from "./agent-settings";

export type GeneratedAgentContextActor = "orchestrator" | "handler" | "workflow-task";

export type GeneratedAgentContextSectionId =
  | "web-context"
  | "smithers-core"
  | "smithers-memory"
  | "smithers-svvy-boundary"
  | "workflow-authoring-contract"
  | "handler-workflow-authoring-appendix"
  | "execute-typescript";

export interface GeneratedAgentContextEntry {
  id: GeneratedAgentContextSectionId;
  title: string;
  source: string;
  sourcePath: string;
  content: string;
}

export interface GeneratedAgentContextExternalSource {
  id: string;
  kind: "AGENTS.md" | "CLAUDE.md";
  title: string;
  path: string;
  content: string;
  contentHash: string;
  order: number;
  enabled: boolean;
  actors: readonly ExternalInstructionActor[];
  sourceGroup: "builtin_global_root" | "custom_global_root" | "workspace_chain";
  rootId?: string;
  rootLabel?: string;
  readStatus: {
    status: "readable" | "unreadable";
    error?: string;
  };
}

export interface GeneratedAgentContextScope {
  appGlobal: boolean;
  workspaceKeys: string[];
}

export interface GeneratedAgentContextInstructionBlock {
  id: string;
  title: string;
  summary: string;
  body: string;
  enabled: boolean;
  scope: GeneratedAgentContextScope;
  actor: GeneratedAgentContextActor | "common";
  default: boolean;
}

export interface GeneratedAgentContextActorRecipe {
  actor: GeneratedAgentContextActor;
  instructionBlockIds: string[];
  generatedSectionIds: GeneratedAgentContextSectionId[];
}

export interface GeneratedAgentContextState {
  version: 1;
  revision: number;
  updatedAt: string;
  instructionBlocks: Record<string, GeneratedAgentContextInstructionBlock>;
  actorRecipes: Record<GeneratedAgentContextActor, GeneratedAgentContextActorRecipe>;
}

export interface UpdateGeneratedAgentContextRequest {
  state: GeneratedAgentContextState;
}

export interface GeneratedAgentContextSnapshotSummary {
  id: string;
  name: string;
  createdAt: string;
  revision: number;
  contentKey: string;
}

export interface CreateGeneratedAgentContextSnapshotRequest {
  name: string;
}

export interface RenameGeneratedAgentContextSnapshotRequest {
  snapshotId: string;
  name: string;
}

export interface RestoreGeneratedAgentContextSnapshotRequest {
  snapshotId: string;
}

export function getGeneratedAgentContextContentKey(state: GeneratedAgentContextState): string {
  return JSON.stringify(
    sortGeneratedAgentContextValue({
      version: state.version,
      instructionBlocks: state.instructionBlocks,
      actorRecipes: state.actorRecipes,
    }),
  );
}

function sortGeneratedAgentContextValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortGeneratedAgentContextValue);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortGeneratedAgentContextValue(entry)]),
  );
}
