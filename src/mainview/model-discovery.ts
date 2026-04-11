import type { Model } from "@mariozechner/pi-ai";

export type AutoDiscoveryProviderType = "ollama" | "llama.cpp" | "vllm" | "lmstudio";

function defaultModel(baseUrl: string, id: string): Model<any> {
  return {
    id,
    name: id,
    api: "openai-completions",
    provider: "",
    baseUrl: `${baseUrl.replace(/\/$/, "")}/v1`,
    reasoning: false,
    input: ["text"],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 8192,
    maxTokens: 4096,
  };
}

async function fetchJson<T>(url: string, apiKey?: string): Promise<T> {
  const headers: HeadersInit = {};
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as T;
}

export async function discoverModels(
  type: AutoDiscoveryProviderType,
  baseUrl: string,
  apiKey?: string,
): Promise<Model<any>[]> {
  if (type === "ollama") {
    const data = await fetchJson<{ models?: Array<{ name?: string }> }>(
      `${baseUrl.replace(/\/$/, "")}/api/tags`,
      apiKey,
    );
    return (data.models || [])
      .map((entry) => entry.name)
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      .map((name) => ({
        ...defaultModel(baseUrl, name),
        baseUrl: `${baseUrl.replace(/\/$/, "")}/v1`,
      }));
  }

  const data = await fetchJson<{
    data?: Array<{
      id?: string;
      context_length?: number;
      max_model_len?: number;
      max_tokens?: number;
    }>;
  }>(`${baseUrl.replace(/\/$/, "")}/v1/models`, apiKey);

  return (data.data || [])
    .map((entry) => {
      if (!entry.id) return null;
      const contextWindow = entry.context_length || entry.max_model_len || 8192;
      return {
        ...defaultModel(baseUrl, entry.id),
        contextWindow,
        maxTokens: entry.max_tokens || Math.min(contextWindow, 4096),
      };
    })
    .filter((entry): entry is Model<any> => entry !== null);
}
