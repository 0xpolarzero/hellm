import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  GeneratedAgentContextActor,
  GeneratedAgentContextActorRecipe,
  GeneratedAgentContextSectionId,
  GeneratedAgentContextInstructionBlock,
  GeneratedAgentContextState,
} from "../shared/generated-agent-context";
import { createDefaultGeneratedAgentContextState } from "./default-system-prompt";

export type GeneratedAgentContextStore = {
  getState(): GeneratedAgentContextState;
};

const GENERATED_AGENT_CONTEXT_FILENAME = "generated-agent-context.json";
const ACTORS: GeneratedAgentContextActor[] = ["orchestrator", "handler", "workflow-task"];
const GENERATED_SECTION_IDS: GeneratedAgentContextSectionId[] = [
  "web-context",
  "smithers-core",
  "smithers-memory",
  "smithers-svvy-boundary",
  "workflow-authoring-contract",
  "handler-workflow-authoring-appendix",
  "execute-typescript",
];

export function createGeneratedAgentContextStore(input: {
  agentDir: string;
}): GeneratedAgentContextStore {
  const libraryPath = join(input.agentDir, GENERATED_AGENT_CONTEXT_FILENAME);

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

  return {
    getState: readState,
  };
}

function normalizeGeneratedAgentContextState(
  input: Partial<GeneratedAgentContextState>,
  overrides: Partial<Pick<GeneratedAgentContextState, "revision" | "updatedAt">> = {},
): GeneratedAgentContextState {
  const defaults = createDefaultGeneratedAgentContextState();
  const instructionBlocks = normalizeInstructionBlocks(input.instructionBlocks, defaults);
  const actorRecipes = normalizeActorRecipes(input.actorRecipes, defaults);
  return {
    version: 1,
    revision: normalizePositiveInteger(overrides.revision ?? input.revision, defaults.revision),
    updatedAt: normalizeTimestamp(overrides.updatedAt ?? input.updatedAt, defaults.updatedAt),
    instructionBlocks,
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
