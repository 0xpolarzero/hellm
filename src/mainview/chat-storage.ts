import type { Model } from "@mariozechner/pi-ai";
import type { PromptHistoryEntry } from "./prompt-history";

const DB_NAME = "svvy-desktop-chat";
const DB_VERSION = 4;
const PROVIDER_KEYS_STORE = "provider-keys";
const CUSTOM_PROVIDERS_STORE = "custom-providers";
const PROMPT_HISTORY_STORE = "prompt-history";
const WORKSPACE_UI_RESTORE_STORE = "workspace-ui-restore";

export type AutoDiscoveryProviderType = "ollama" | "llama.cpp" | "vllm" | "lmstudio";

export type CustomProviderType =
  | AutoDiscoveryProviderType
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages";

export interface CustomProvider {
  id: string;
  name: string;
  type: CustomProviderType;
  baseUrl: string;
  apiKey?: string;
  models?: Model<any>[];
}

class IndexedDbKeyValueStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.addEventListener("error", () => reject(request.error), { once: true });
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener("upgradeneeded", () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(PROVIDER_KEYS_STORE)) {
            db.createObjectStore(PROVIDER_KEYS_STORE);
          }
          if (!db.objectStoreNames.contains(CUSTOM_PROVIDERS_STORE)) {
            db.createObjectStore(CUSTOM_PROVIDERS_STORE);
          }
          if (!db.objectStoreNames.contains(PROMPT_HISTORY_STORE)) {
            db.createObjectStore(PROMPT_HISTORY_STORE);
          }
          if (!db.objectStoreNames.contains(WORKSPACE_UI_RESTORE_STORE)) {
            db.createObjectStore(WORKSPACE_UI_RESTORE_STORE);
          }
        });
      });
    }

    return this.dbPromise;
  }

  private async execute<T>(
    storeName: string,
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.getDb();
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = operation(store);

    return await new Promise<T>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
  }

  async get<T>(storeName: string, key: string): Promise<T | null> {
    const result = await this.execute<T | undefined>(storeName, "readonly", (store) =>
      store.get(key),
    );
    return result ?? null;
  }

  async set<T>(storeName: string, key: string, value: T): Promise<void> {
    await this.execute(storeName, "readwrite", (store) => store.put(value, key));
  }

  async delete(storeName: string, key: string): Promise<void> {
    await this.execute(storeName, "readwrite", (store) => store.delete(key));
  }

  async keys(storeName: string): Promise<string[]> {
    const keys = await this.execute<IDBValidKey[]>(storeName, "readonly", (store) =>
      store.getAllKeys(),
    );
    return keys.map((key) => String(key));
  }

  async has(storeName: string, key: string): Promise<boolean> {
    const result = await this.execute<IDBValidKey | undefined>(storeName, "readonly", (store) =>
      store.getKey(key),
    );
    return result !== undefined;
  }
}

export class ProviderKeysStore {
  constructor(private backend: IndexedDbKeyValueStore) {}

  async get(provider: string): Promise<string | null> {
    return this.backend.get<string>(PROVIDER_KEYS_STORE, provider);
  }

  async set(provider: string, key: string): Promise<void> {
    await this.backend.set(PROVIDER_KEYS_STORE, provider, key);
  }

  async delete(provider: string): Promise<void> {
    await this.backend.delete(PROVIDER_KEYS_STORE, provider);
  }

  async list(): Promise<string[]> {
    return this.backend.keys(PROVIDER_KEYS_STORE);
  }

  async has(provider: string): Promise<boolean> {
    return this.backend.has(PROVIDER_KEYS_STORE, provider);
  }
}

export class CustomProvidersStore {
  constructor(private backend: IndexedDbKeyValueStore) {}

  async get(id: string): Promise<CustomProvider | null> {
    return this.backend.get<CustomProvider>(CUSTOM_PROVIDERS_STORE, id);
  }

  async set(provider: CustomProvider): Promise<void> {
    await this.backend.set(CUSTOM_PROVIDERS_STORE, provider.id, provider);
  }

  async delete(id: string): Promise<void> {
    await this.backend.delete(CUSTOM_PROVIDERS_STORE, id);
  }

  async getAll(): Promise<CustomProvider[]> {
    const keys = await this.backend.keys(CUSTOM_PROVIDERS_STORE);
    const providers = await Promise.all(keys.map((key) => this.get(key)));
    return providers.filter((provider): provider is CustomProvider => provider !== null);
  }

  async has(id: string): Promise<boolean> {
    return this.backend.has(CUSTOM_PROVIDERS_STORE, id);
  }
}

export class PromptHistoryStore {
  constructor(private backend: IndexedDbKeyValueStore) {}

  async list(workspaceId: string): Promise<PromptHistoryEntry[]> {
    return (await this.backend.get<PromptHistoryEntry[]>(PROMPT_HISTORY_STORE, workspaceId)) ?? [];
  }

  async replace(workspaceId: string, entries: PromptHistoryEntry[]): Promise<void> {
    await this.backend.set(PROMPT_HISTORY_STORE, workspaceId, entries);
  }

  async append(entry: PromptHistoryEntry): Promise<PromptHistoryEntry> {
    const existingEntries = await this.list(entry.workspaceId);
    await this.backend.set(PROMPT_HISTORY_STORE, entry.workspaceId, [...existingEntries, entry]);
    return entry;
  }
}

export type WorkspaceInspectorSelection =
  | { kind: "thread"; threadId: string }
  | { kind: "workflow-run"; workflowRunId: string }
  | { kind: "artifact"; artifactId: string }
  | { kind: "ci-run"; ciRunId: string };

export interface WorkspaceUiRestorePaneState {
  paneId: string;
  workspaceSessionId: string;
  surfacePiSessionId: string;
  surface: "orchestrator" | "thread";
  threadId?: string;
  inspectorSelection?: WorkspaceInspectorSelection | null;
}

export interface WorkspaceUiRestoreState {
  version: 1;
  focusedPaneId: string | null;
  panes: WorkspaceUiRestorePaneState[];
  updatedAt: string;
}

export class WorkspaceUiRestoreStore {
  constructor(private backend: IndexedDbKeyValueStore) {}

  async get(workspaceId: string): Promise<WorkspaceUiRestoreState | null> {
    const state = await this.backend.get<WorkspaceUiRestoreState>(
      WORKSPACE_UI_RESTORE_STORE,
      workspaceId,
    );
    if (!state || state.version !== 1 || !Array.isArray(state.panes)) {
      return null;
    }
    return state;
  }

  async set(workspaceId: string, state: WorkspaceUiRestoreState): Promise<void> {
    await this.backend.set(WORKSPACE_UI_RESTORE_STORE, workspaceId, state);
  }
}

export interface ChatStorage {
  providerKeys: ProviderKeysStore;
  customProviders: CustomProvidersStore;
  promptHistory: PromptHistoryStore;
  workspaceUiRestore: WorkspaceUiRestoreStore;
}

export function createChatStorage(): ChatStorage {
  const backend = new IndexedDbKeyValueStore();
  return {
    providerKeys: new ProviderKeysStore(backend),
    customProviders: new CustomProvidersStore(backend),
    promptHistory: new PromptHistoryStore(backend),
    workspaceUiRestore: new WorkspaceUiRestoreStore(backend),
  };
}
