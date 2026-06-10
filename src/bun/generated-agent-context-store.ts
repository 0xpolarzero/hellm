import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getGeneratedAgentContextContentKey } from "../shared/generated-agent-context";
import type {
  GeneratedAgentContextActor,
  GeneratedAgentContextActorRecipe,
  GeneratedAgentContextContextPack,
  GeneratedAgentContextSectionId,
  GeneratedAgentContextInstructionBlock,
  GeneratedAgentContextSnapshotSummary,
  GeneratedAgentContextState,
} from "../shared/generated-agent-context";
import { createDefaultGeneratedAgentContextState } from "./default-system-prompt";

export type GeneratedAgentContextStore = {
  getState(): GeneratedAgentContextState;
  updateState(state: GeneratedAgentContextState): GeneratedAgentContextState;
  resetState(): GeneratedAgentContextState;
  listSnapshots(): GeneratedAgentContextSnapshotSummary[];
  createSnapshot(name: string): GeneratedAgentContextSnapshotSummary;
  renameSnapshot(snapshotId: string, name: string): GeneratedAgentContextSnapshotSummary;
  restoreSnapshot(snapshotId: string): GeneratedAgentContextState;
  getPath(): string;
};

const GENERATED_AGENT_CONTEXT_FILENAME = "generated-agent-context.json";
const GENERATED_AGENT_CONTEXT_SNAPSHOTS_FILENAME = "generated-agent-context-snapshots.json";
const ACTORS: GeneratedAgentContextActor[] = ["orchestrator", "handler", "workflow-task"];
const GENERATED_SECTION_IDS: GeneratedAgentContextSectionId[] = [
  "web-context",
  "smithers-core",
  "smithers-memory",
  "smithers-svvy-boundary",
  "workflow-authoring-contract",
  "handler-workflow-authoring-appendix",
  "loaded-optional-context",
  "execute-typescript",
];

export function createGeneratedAgentContextStore(input: {
  agentDir: string;
}): GeneratedAgentContextStore {
  const libraryPath = join(input.agentDir, GENERATED_AGENT_CONTEXT_FILENAME);
  const snapshotsPath = join(input.agentDir, GENERATED_AGENT_CONTEXT_SNAPSHOTS_FILENAME);

  const writeState = (state: GeneratedAgentContextState): GeneratedAgentContextState => {
    mkdirSync(dirname(libraryPath), { recursive: true });
    writeFileSync(libraryPath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  };

  const readState = (): GeneratedAgentContextState => {
    if (!existsSync(libraryPath)) {
      return writeState(createDefaultGeneratedAgentContextState());
    }
    try {
      return normalizeGeneratedAgentContextState(
        JSON.parse(readFileSync(libraryPath, "utf8")) as Partial<GeneratedAgentContextState>,
      );
    } catch {
      return writeState(createDefaultGeneratedAgentContextState());
    }
  };

  const writeSnapshots = (
    snapshots: GeneratedAgentContextSnapshot[],
  ): GeneratedAgentContextSnapshot[] => {
    mkdirSync(dirname(snapshotsPath), { recursive: true });
    writeFileSync(snapshotsPath, `${JSON.stringify({ version: 1, snapshots }, null, 2)}\n`);
    return snapshots;
  };

  const readSnapshots = (): GeneratedAgentContextSnapshot[] => {
    if (!existsSync(snapshotsPath)) {
      return [];
    }
    try {
      const parsed = JSON.parse(readFileSync(snapshotsPath, "utf8")) as Partial<{
        snapshots: unknown[];
      }>;
      return normalizeSnapshots(parsed.snapshots);
    } catch {
      return writeSnapshots([]);
    }
  };

  return {
    getState: readState,
    updateState: (state) => {
      const current = readState();
      const normalized = normalizeGeneratedAgentContextState(state, {
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      return writeState(normalized);
    },
    resetState: () => {
      const current = readState();
      return writeState(
        createDefaultGeneratedAgentContextState(new Date().toISOString(), current.revision + 1),
      );
    },
    listSnapshots: () => summarizeSnapshots(readSnapshots()),
    createSnapshot: (name) => {
      const snapshots = readSnapshots();
      const state = readState();
      const snapshot = normalizeSnapshot({
        id: randomUUID(),
        name: normalizeSnapshotName(name, state.updatedAt),
        createdAt: new Date().toISOString(),
        state,
      });
      if (!snapshot) {
        throw new Error("Unable to create generated agent context snapshot.");
      }
      writeSnapshots([snapshot, ...snapshots]);
      return summarizeSnapshot(snapshot);
    },
    renameSnapshot: (snapshotId, name) => {
      const snapshots = readSnapshots();
      const index = snapshots.findIndex((snapshot) => snapshot.id === snapshotId);
      if (index === -1) {
        throw new Error("Generated agent context snapshot not found.");
      }
      const snapshot = {
        ...snapshots[index]!,
        name: normalizeSnapshotName(name, snapshots[index]!.createdAt),
      };
      snapshots[index] = snapshot;
      writeSnapshots(snapshots);
      return summarizeSnapshot(snapshot);
    },
    restoreSnapshot: (snapshotId) => {
      const snapshots = readSnapshots();
      const snapshot = snapshots.find((candidate) => candidate.id === snapshotId);
      if (!snapshot) {
        throw new Error("Generated agent context snapshot not found.");
      }
      const current = readState();
      const restored = normalizeGeneratedAgentContextState(snapshot.state, {
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
      });
      return writeState(restored);
    },
    getPath: () => libraryPath,
  };
}

type GeneratedAgentContextSnapshot = {
  id: string;
  name: string;
  createdAt: string;
  state: GeneratedAgentContextState;
};

function normalizeSnapshots(input: unknown[] | undefined): GeneratedAgentContextSnapshot[] {
  return (input ?? [])
    .map((entry) => normalizeSnapshot(entry))
    .filter((entry): entry is GeneratedAgentContextSnapshot => Boolean(entry))
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function normalizeSnapshot(input: unknown): GeneratedAgentContextSnapshot | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Partial<GeneratedAgentContextSnapshot>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id || !record.state) {
    return null;
  }
  const createdAt = normalizeTimestamp(record.createdAt, new Date().toISOString());
  const state = normalizeGeneratedAgentContextState(record.state);
  return {
    id,
    name: normalizeSnapshotName(record.name, createdAt),
    createdAt,
    state,
  };
}

function summarizeSnapshots(
  snapshots: readonly GeneratedAgentContextSnapshot[],
): GeneratedAgentContextSnapshotSummary[] {
  return snapshots.map(summarizeSnapshot);
}

function summarizeSnapshot(
  snapshot: GeneratedAgentContextSnapshot,
): GeneratedAgentContextSnapshotSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    createdAt: snapshot.createdAt,
    revision: snapshot.state.revision,
    contentKey: getGeneratedAgentContextContentKey(snapshot.state),
  };
}

function normalizeSnapshotName(value: unknown, createdAt: string): string {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return `Snapshot ${new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(createdAt))}`;
}

export function normalizeGeneratedAgentContextState(
  input: Partial<GeneratedAgentContextState>,
  overrides: Partial<Pick<GeneratedAgentContextState, "revision" | "updatedAt">> = {},
): GeneratedAgentContextState {
  const defaults = createDefaultGeneratedAgentContextState();
  const instructionBlocks = normalizeInstructionBlocks(input.instructionBlocks, defaults);
  const contextPacks = normalizeContextPacks(input.contextPacks, defaults);
  const actorRecipes = normalizeActorRecipes(input.actorRecipes, defaults);
  return {
    version: 1,
    revision: normalizePositiveInteger(overrides.revision ?? input.revision, defaults.revision),
    updatedAt: normalizeTimestamp(overrides.updatedAt ?? input.updatedAt, defaults.updatedAt),
    instructionBlocks,
    contextPacks,
    actorRecipes,
  };
}

function normalizeInstructionBlocks(
  input: GeneratedAgentContextState["instructionBlocks"] | undefined,
  defaults: GeneratedAgentContextState,
): GeneratedAgentContextState["instructionBlocks"] {
  const source = input ?? defaults.instructionBlocks;
  const output: GeneratedAgentContextState["instructionBlocks"] = {};
  for (const [id, block] of Object.entries(source)) {
    const normalized = normalizeInstructionBlock(id, block);
    if (normalized) {
      output[normalized.id] = normalized;
    }
  }
  return output;
}

function normalizeInstructionBlock(
  fallbackId: string,
  input: GeneratedAgentContextInstructionBlock,
): GeneratedAgentContextInstructionBlock | null {
  const id = normalizeIdentifier(input.id || fallbackId);
  const actor = input.actor === "common" || ACTORS.includes(input.actor) ? input.actor : "common";
  const title = requireText(input.title, id);
  const body = requireText(input.body, "");
  if (!id || !title || !body) {
    return null;
  }
  return {
    id,
    title,
    summary: input.summary?.trim() ?? "",
    body,
    enabled: input.enabled !== false,
    scope: normalizeScope(input.scope),
    actor,
    default: input.default === true,
  };
}

function normalizeContextPacks(
  input: GeneratedAgentContextState["contextPacks"] | undefined,
  defaults: GeneratedAgentContextState,
): GeneratedAgentContextState["contextPacks"] {
  const source = input ?? defaults.contextPacks;
  const output: GeneratedAgentContextState["contextPacks"] = {};
  for (const [id, pack] of Object.entries(source)) {
    const normalized = normalizeContextPack(id, pack);
    if (normalized) {
      output[normalized.id] = normalized;
    }
  }
  return output;
}

function normalizeContextPack(
  fallbackId: string,
  input: GeneratedAgentContextContextPack,
): GeneratedAgentContextContextPack | null {
  const id = normalizeIdentifier(input.id || fallbackId);
  const title = requireText(input.title, id);
  const body = requireText(input.body, "");
  if (!id || !title || !body) {
    return null;
  }
  const allowedActors = (input.allowedActors ?? []).filter((actor) => ACTORS.includes(actor));
  return {
    id,
    title,
    summary: input.summary?.trim() ?? "",
    body,
    enabled: input.enabled !== false,
    scope: normalizeScope(input.scope),
    allowedActors: allowedActors.length > 0 ? allowedActors : ACTORS,
    default: input.default === true,
    optionalContextKey: input.optionalContextKey?.trim() || undefined,
  };
}

function normalizeActorRecipes(
  input: GeneratedAgentContextState["actorRecipes"] | undefined,
  defaults: GeneratedAgentContextState,
): GeneratedAgentContextState["actorRecipes"] {
  const source = input ?? defaults.actorRecipes;
  const output = {} as GeneratedAgentContextState["actorRecipes"];
  for (const actor of ACTORS) {
    output[actor] = normalizeActorRecipe(actor, source[actor], defaults.actorRecipes[actor]);
  }
  return output;
}

function normalizeActorRecipe(
  actor: GeneratedAgentContextActor,
  input: GeneratedAgentContextActorRecipe | undefined,
  fallback: GeneratedAgentContextActorRecipe,
): GeneratedAgentContextActorRecipe {
  return {
    actor,
    instructionBlockIds: normalizeIdList(input?.instructionBlockIds, fallback.instructionBlockIds),
    contextPackIds: normalizeIdList(input?.contextPackIds, fallback.contextPackIds),
    generatedSectionIds: normalizeGeneratedSectionIds(
      input?.generatedSectionIds,
      fallback.generatedSectionIds,
    ),
  };
}

function normalizeGeneratedSectionIds(
  input: readonly string[] | undefined,
  fallback: readonly GeneratedAgentContextSectionId[],
): GeneratedAgentContextSectionId[] {
  const sections = (input ?? fallback).filter(
    (section): section is GeneratedAgentContextSectionId =>
      GENERATED_SECTION_IDS.includes(section as GeneratedAgentContextSectionId),
  );
  return sections.length > 0 ? [...new Set(sections)] : [...fallback];
}

function normalizeIdList(
  input: readonly string[] | undefined,
  fallback: readonly string[],
): string[] {
  const ids = (input ?? fallback).map(normalizeIdentifier).filter(Boolean);
  return ids.length > 0 ? [...new Set(ids)] : [...fallback];
}

function normalizeIdentifier(value: string): string {
  return value.trim();
}

function requireText(value: string, fallback: string): string {
  return value?.trim() || fallback;
}

function normalizeScope(input: GeneratedAgentContextInstructionBlock["scope"] | undefined) {
  return {
    appGlobal: input?.appGlobal !== false,
    workspaceKeys: Array.isArray(input?.workspaceKeys)
      ? [...new Set(input.workspaceKeys.map((key) => key.trim()).filter(Boolean))]
      : [],
  };
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return Number.isNaN(new Date(value).getTime()) ? fallback : value;
}
