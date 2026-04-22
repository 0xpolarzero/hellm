import { getModels, getProviders } from "@mariozechner/pi-ai";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { getProviderEnvVar, resolveAuthState } from "../auth-store";

export type WorkflowAssetKind = "definition" | "prompt" | "component";
export type WorkflowAssetScope = "saved" | "artifact";

export type WorkflowAssetMetadata = {
  id: string;
  kind: WorkflowAssetKind;
  title: string;
  summary: string;
  path: string;
  scope: WorkflowAssetScope;
  subtype?: string;
  tags: string[];
  exports: string[];
  variables: string[];
  providerModelSummary?: string;
  toolsetSummary?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkflowAssetFilter = {
  kind?: WorkflowAssetKind;
  subtype?: string;
  tags?: string[];
  pathPrefix?: string;
  exports?: string[];
  scope?: WorkflowAssetScope | "both";
};

export type WorkflowModelInfo = {
  providerId: string;
  modelId: string;
  authAvailable: boolean;
  authSource: string;
  capabilityFlags: string[];
};

export type WorkflowAssetDiscovery = {
  listAssets(input?: WorkflowAssetFilter): WorkflowAssetMetadata[];
  listModels(): WorkflowModelInfo[];
};

type WorkflowAssetDiscoveryDependencies = {
  getProviders?: typeof getProviders;
  getModels?: typeof getModels;
  resolveAuthState?: typeof resolveAuthState;
  getProviderEnvVar?: typeof getProviderEnvVar;
};

function walkFiles(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      files.push(entryPath);
    }
  }

  return files.toSorted();
}

function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  return relative(workspaceRoot, path).replace(/\\/g, "/");
}

function splitCsv(value: string | undefined): string[] {
  return value
    ? value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function readTsJsdocTag(header: string, tag: string): string | undefined {
  const match = header.match(new RegExp(`@${tag}\\s+([^\\n*]+)`));
  return match?.[1]?.trim();
}

function parseFrontmatter(text: string): Record<string, string | string[]> {
  if (!text.startsWith("---\n")) {
    return {};
  }

  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return {};
  }

  const result: Record<string, string | string[]> = {};
  let currentListKey: string | null = null;
  for (const line of text.slice(4, end).split("\n")) {
    if (line.startsWith("  - ") && currentListKey) {
      const current = result[currentListKey];
      const values = Array.isArray(current) ? current : [];
      values.push(line.slice(4).trim());
      result[currentListKey] = values;
      continue;
    }

    currentListKey = null;
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    if (!rawValue) {
      result[key] = [];
      currentListKey = key;
      continue;
    }
    result[key] = rawValue;
  }

  return result;
}

function parseAssetMetadata(
  workspaceRoot: string,
  path: string,
  scope: WorkflowAssetScope,
): WorkflowAssetMetadata {
  const text = readFileSync(path, "utf8");
  const stats = statSync(path);
  if (extname(path) === ".mdx") {
    const frontmatter = parseFrontmatter(text);
    return {
      id: String(frontmatter.svvyId ?? relativeWorkspacePath(workspaceRoot, path)),
      kind: "prompt",
      title: String(frontmatter.title ?? relativeWorkspacePath(workspaceRoot, path)),
      summary: String(frontmatter.summary ?? ""),
      path: relativeWorkspacePath(workspaceRoot, path),
      scope,
      subtype: typeof frontmatter.svvySubtype === "string" ? frontmatter.svvySubtype : undefined,
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags.map(String) : [],
      exports: [],
      variables: Array.isArray(frontmatter.variables) ? frontmatter.variables.map(String) : [],
      createdAt: stats.birthtime.toISOString(),
      updatedAt: stats.mtime.toISOString(),
    };
  }

  const header = text.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";
  return {
    id: readTsJsdocTag(header, "svvyId") ?? relativeWorkspacePath(workspaceRoot, path),
    kind: (readTsJsdocTag(header, "svvyAssetKind") as WorkflowAssetKind | undefined) ?? "component",
    title: readTsJsdocTag(header, "svvyTitle") ?? relativeWorkspacePath(workspaceRoot, path),
    summary: readTsJsdocTag(header, "svvySummary") ?? "",
    path: relativeWorkspacePath(workspaceRoot, path),
    scope,
    subtype: readTsJsdocTag(header, "svvySubtype"),
    tags: splitCsv(readTsJsdocTag(header, "svvyTags")),
    exports: splitCsv(readTsJsdocTag(header, "svvyExports")),
    variables: [],
    providerModelSummary: readTsJsdocTag(header, "svvyProviderModelSummary"),
    toolsetSummary: readTsJsdocTag(header, "svvyToolsetSummary"),
    createdAt: stats.birthtime.toISOString(),
    updatedAt: stats.mtime.toISOString(),
  };
}

function listAssetFiles(workspaceRoot: string, scope: WorkflowAssetScope): string[] {
  const root =
    scope === "saved"
      ? join(workspaceRoot, ".svvy", "workflows")
      : join(workspaceRoot, ".svvy", "artifacts", "workflows");
  return walkFiles(root).filter((path) =>
    ["/definitions/", "/prompts/", "/components/"].some((segment) => path.includes(segment)),
  );
}

export function listWorkflowAssets(
  workspaceRoot: string,
  input: WorkflowAssetFilter = {},
): WorkflowAssetMetadata[] {
  const scopes =
    input.scope === "artifact"
      ? (["artifact"] as const)
      : input.scope === "both"
        ? (["saved", "artifact"] as const)
        : (["saved"] as const);

  return scopes
    .flatMap((scope) =>
      listAssetFiles(workspaceRoot, scope)
        .filter((path) => [".ts", ".tsx", ".mdx"].includes(extname(path)))
        .map((path) => parseAssetMetadata(workspaceRoot, path, scope)),
    )
    .filter((asset) => (input.kind ? asset.kind === input.kind : true))
    .filter((asset) => (input.subtype ? asset.subtype === input.subtype : true))
    .filter((asset) =>
      input.tags && input.tags.length > 0
        ? input.tags.every((tag) => asset.tags.includes(tag))
        : true,
    )
    .filter((asset) => (input.pathPrefix ? asset.path.startsWith(input.pathPrefix) : true))
    .filter((asset) =>
      input.exports && input.exports.length > 0
        ? input.exports.every((exportName) => asset.exports.includes(exportName))
        : true,
    )
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

function readCapabilityFlags(model: {
  reasoning: boolean;
  input: string[];
  api: string;
}): string[] {
  return [
    model.reasoning ? "reasoning" : null,
    model.input.includes("image") ? "vision" : null,
    [
      "anthropic-messages",
      "google-generative-ai",
      "mistral-conversations",
      "openai-completions",
      "openai-responses",
    ].includes(model.api)
      ? "tool-calling"
      : null,
  ].filter((flag): flag is string => Boolean(flag));
}

export function listWorkflowModels(
  dependencies: WorkflowAssetDiscoveryDependencies = {},
): WorkflowModelInfo[] {
  const resolveProviders = dependencies.getProviders ?? getProviders;
  const resolveModels = dependencies.getModels ?? getModels;
  const resolveAuth = dependencies.resolveAuthState ?? resolveAuthState;
  const resolveEnvVar = dependencies.getProviderEnvVar ?? getProviderEnvVar;

  return resolveProviders()
    .flatMap((providerId) =>
      resolveModels(providerId).map((model) => {
        const authState = resolveAuth(providerId);
        const authSource =
          authState.keyType === "none"
            ? `missing:${resolveEnvVar(providerId) ?? providerId}`
            : authState.keyType;
        return {
          providerId,
          modelId: model.id,
          authAvailable: authState.connected,
          authSource,
          capabilityFlags: readCapabilityFlags(model),
        };
      }),
    )
    .toSorted(
      (left, right) =>
        left.providerId.localeCompare(right.providerId) ||
        left.modelId.localeCompare(right.modelId),
    );
}

export function createWorkflowAssetDiscovery(
  workspaceRoot: string,
  dependencies: WorkflowAssetDiscoveryDependencies = {},
): WorkflowAssetDiscovery {
  return {
    listAssets: (input) => listWorkflowAssets(workspaceRoot, input),
    listModels: () => listWorkflowModels(dependencies),
  };
}
