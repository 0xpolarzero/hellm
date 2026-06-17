import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  CreateManagedSnippetRequest,
  DeleteManagedSnippetRequest,
  ManagedSnippet,
  SetSnippetEnabledRequest,
  SnippetMetadata,
  UpdateManagedSnippetRequest,
} from "../shared/snippets";

export type SnippetStore = {
  listManaged(): ManagedSnippet[];
  createManaged(input: CreateManagedSnippetRequest): ManagedSnippet;
  updateManaged(input: UpdateManagedSnippetRequest): ManagedSnippet;
  deleteManaged(input: DeleteManagedSnippetRequest): void;
  setEnabled(input: SetSnippetEnabledRequest): void;
  listDisabledSnippetIds(): string[];
  getPath(): string;
};

interface SnippetStoreState {
  version: 1;
  revision: number;
  updatedAt: string;
  snippets: ManagedSnippet[];
  disabledSnippetIds: string[];
}

const SNIPPETS_FILENAME = "snippets.json";

export function createSnippetStore(input: { agentDir: string }): SnippetStore {
  const storePath = join(input.agentDir, SNIPPETS_FILENAME);

  const writeState = (state: SnippetStoreState): SnippetStoreState => {
    mkdirSync(dirname(storePath), { recursive: true });
    writeFileSync(storePath, `${JSON.stringify(state, null, 2)}\n`);
    return state;
  };

  const readState = (): SnippetStoreState => {
    if (!existsSync(storePath)) {
      return writeState(createEmptyState());
    }
    try {
      return normalizeState(
        JSON.parse(readFileSync(storePath, "utf8")) as Partial<SnippetStoreState>,
      );
    } catch {
      return writeState(createEmptyState());
    }
  };

  const updateState = (
    updater: (state: SnippetStoreState) => SnippetStoreState,
  ): SnippetStoreState => {
    const current = readState();
    const now = new Date().toISOString();
    return writeState(
      normalizeState({
        ...updater(current),
        revision: current.revision + 1,
        updatedAt: now,
      }),
    );
  };

  return {
    listManaged: () => {
      const state = readState();
      const disabledIds = new Set(state.disabledSnippetIds);
      return state.snippets.map((snippet) => ({
        ...snippet,
        enabled: !disabledIds.has(snippet.id),
      }));
    },
    createManaged: (request) => {
      const now = new Date().toISOString();
      const snippet: ManagedSnippet = {
        id: randomUUID(),
        source: "svvy",
        title: normalizeTitle(request.title),
        body: normalizeBody(request.body),
        metadata: normalizeMetadata({
          description: request.description,
          argumentHint: request.argumentHint,
        }),
        enabled: true,
        createdAt: now,
        updatedAt: now,
        readOnly: false,
      };
      updateState((state) => ({
        ...state,
        snippets: [...state.snippets, snippet],
      }));
      return snippet;
    },
    updateManaged: (request) => {
      let updated: ManagedSnippet | null = null;
      updateState((state) => {
        const index = state.snippets.findIndex((snippet) => snippet.id === request.snippetId);
        if (index === -1) {
          throw new Error("Managed snippet not found.");
        }
        const current = state.snippets[index]!;
        const next: ManagedSnippet = {
          ...current,
          title: request.title === undefined ? current.title : normalizeTitle(request.title),
          body: request.body === undefined ? current.body : normalizeBody(request.body),
          metadata: normalizeMetadata({
            description:
              request.description === undefined
                ? current.metadata.description
                : request.description,
            argumentHint:
              request.argumentHint === undefined
                ? current.metadata.argumentHint
                : request.argumentHint,
          }),
          updatedAt: new Date().toISOString(),
        };
        updated = next;
        const snippets = [...state.snippets];
        snippets[index] = next;
        return { ...state, snippets };
      });
      if (!updated) {
        throw new Error("Managed snippet not found.");
      }
      return updated;
    },
    deleteManaged: (request) => {
      updateState((state) => {
        const snippets = state.snippets.filter((snippet) => snippet.id !== request.snippetId);
        if (snippets.length === state.snippets.length) {
          throw new Error("Managed snippet not found.");
        }
        return {
          ...state,
          snippets,
          disabledSnippetIds: state.disabledSnippetIds.filter((id) => id !== request.snippetId),
        };
      });
    },
    setEnabled: (request) => {
      updateState((state) => {
        const snippetId = normalizeSnippetId(request.snippetId);
        const disabledIds = new Set(state.disabledSnippetIds);
        if (request.enabled) {
          disabledIds.delete(snippetId);
        } else {
          disabledIds.add(snippetId);
        }
        return {
          ...state,
          disabledSnippetIds: [...disabledIds].toSorted((left, right) => left.localeCompare(right)),
        };
      });
    },
    listDisabledSnippetIds: () => readState().disabledSnippetIds,
    getPath: () => storePath,
  };
}

function createEmptyState(): SnippetStoreState {
  return {
    version: 1,
    revision: 1,
    updatedAt: new Date().toISOString(),
    snippets: [],
    disabledSnippetIds: [],
  };
}

function normalizeState(input: Partial<SnippetStoreState>): SnippetStoreState {
  const fallback = createEmptyState();
  return {
    version: 1,
    revision: normalizePositiveInteger(input.revision, fallback.revision),
    updatedAt: normalizeTimestamp(input.updatedAt, fallback.updatedAt),
    snippets: (input.snippets ?? [])
      .map((snippet) => normalizeManagedSnippet(snippet))
      .filter((snippet): snippet is ManagedSnippet => Boolean(snippet))
      .toSorted(
        (left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id),
      ),
    disabledSnippetIds: normalizeStringList(input.disabledSnippetIds),
  };
}

function normalizeManagedSnippet(input: unknown): ManagedSnippet | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Partial<ManagedSnippet>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const title = typeof record.title === "string" ? record.title.trim() : "";
  if (!id || !title) {
    return null;
  }
  const now = new Date().toISOString();
  return {
    id,
    source: "svvy",
    title,
    body: typeof record.body === "string" ? record.body : "",
    metadata: normalizeMetadata(record.metadata),
    enabled: record.enabled !== false,
    createdAt: normalizeTimestamp(record.createdAt, now),
    updatedAt: normalizeTimestamp(record.updatedAt, now),
    readOnly: false,
  };
}

function normalizeSnippetId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Snippet id is required.");
  }
  return value.trim();
}

function normalizeStringList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => (typeof value === "string" ? value.trim() : "")))]
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));
}

function normalizeTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Managed snippet title is required.");
  }
  return value.trim();
}

function normalizeBody(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeMetadata(input: Partial<SnippetMetadata> | undefined): SnippetMetadata {
  return {
    description: normalizeNullableText(input?.description),
    argumentHint: normalizeNullableText(input?.argumentHint),
  };
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeTimestamp(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
}
