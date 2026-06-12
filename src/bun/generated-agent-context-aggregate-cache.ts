import { Database } from "bun:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SvvyActorKind } from "./actor-capabilities";
import type { ResolvedExtensionRecord } from "./svvyx-extensions-command";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";

export const GENERATED_AGENT_CONTEXT_AGGREGATE_FORMAT_VERSION = 1;
export const DEFAULT_AGGREGATE_CACHE_BUDGET_BYTES = 256 * 1024 * 1024;
export const DEFAULT_AGGREGATE_CACHE_UNUSED_ELIGIBILITY_MS = 30 * 24 * 60 * 60 * 1000;

export type GeneratedAgentContextAggregateOutputs = {
  prompt: string;
  svvyxGuidance: string;
  commandsDts: string;
  nativeToolSchemasJson: string;
};

export type GeneratedAgentContextAggregateResult = {
  cacheKey: string;
  hit: boolean;
  outputs: GeneratedAgentContextAggregateOutputs;
};

export type GeneratedAgentContextAggregateKeyInputs = {
  actorKind: SvvyActorKind;
  loadedExtensionIds: readonly string[];
  availableExtensionIds: readonly string[];
  extensionContextFingerprints: Record<string, string>;
  generatedAgentContextContentKey: string;
  agentContextFormatVersion: number;
  externalInstructionsFingerprint: string;
  promptSettingsFingerprint: string;
  workspaceKey: string;
};

type CacheRow = {
  cache_key: string;
  actor_kind: SvvyActorKind;
  loaded_extension_ids_json: string;
  available_extension_ids_json: string;
  extension_context_fingerprints_json: string;
  agent_context_format_version: number;
  external_instructions_fingerprint: string;
  agent_context_fingerprint: string;
  created_at: string;
  last_used_at: string;
  size_bytes: number;
};

type BlobManifest = {
  version: 1;
  cacheKey: string;
  inputs: GeneratedAgentContextAggregateKeyInputs;
  agentContextFingerprint: string;
  files: Record<keyof GeneratedAgentContextAggregateOutputs, { path: string; sha256: string }>;
};

export function defaultExtensionsRoot(): string {
  return join(homedir(), ".config", "svvy", "extensions");
}

export function extensionsRootForAgentDir(agentDir: string): string {
  return join(dirname(agentDir), "extensions");
}

export function createExternalInstructionsFingerprint(
  sources: readonly GeneratedAgentContextExternalSource[],
): string {
  return sha256Json(
    sources.map((source) => ({
      actors: [...source.actors].toSorted(),
      contentHash: source.contentHash,
      enabled: source.enabled,
      kind: source.kind,
      path: source.path.replaceAll("\\", "/"),
      readStatus: source.readStatus.status,
      rootId: source.rootId ?? null,
      sourceGroup: source.sourceGroup,
    })),
  );
}

export function createExtensionContextFingerprints(
  records: readonly ResolvedExtensionRecord[],
): Record<string, string> {
  return Object.fromEntries(
    records
      .map((record) => [record.id, createExtensionContextFingerprint(record)] as const)
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

export function createExtensionContextFingerprint(record: ResolvedExtensionRecord): string {
  return (
    record.extensionBuildFingerprint ??
    sha256Json({
      category: record.category,
      cliRequirements: record.cliRequirements ?? [],
      dependencyReadiness: record.dependencyReadiness,
      description: record.description,
      envReadiness: record.envReadiness,
      generatedInstructions: record.generatedInstructions ?? [],
      id: record.id,
      instructionFiles: record.instructionFiles ?? [],
      instructionSourceFiles: record.instructionSourceFiles.map((file) =>
        file.replaceAll("\\", "/"),
      ),
      interface: record.interface,
      minimalLoadingHint: record.minimalLoadingHint,
      title: record.title,
      typescriptApiEnabled: record.typescriptApiEnabled,
    })
  );
}

export function createGeneratedAgentContextAggregateCache(
  options: {
    extensionsRoot?: string;
    maxSizeBytes?: number;
    now?: () => Date;
    unusedEligibilityMs?: number;
  } = {},
) {
  const extensionsRoot = options.extensionsRoot ?? defaultExtensionsRoot();
  const root = join(extensionsRoot, "generated", "aggregates");
  const blobsRoot = join(root, "blobs");
  const databasePath = join(root, "index.sqlite");
  const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_AGGREGATE_CACHE_BUDGET_BYTES;
  const unusedEligibilityMs =
    options.unusedEligibilityMs ?? DEFAULT_AGGREGATE_CACHE_UNUSED_ELIGIBILITY_MS;
  const now = options.now ?? (() => new Date());
  mkdirSync(blobsRoot, { recursive: true });
  const db = new Database(databasePath);
  db.run(`
    CREATE TABLE IF NOT EXISTS aggregate_cache (
      cache_key TEXT PRIMARY KEY,
      actor_kind TEXT NOT NULL,
      loaded_extension_ids_json TEXT NOT NULL,
      available_extension_ids_json TEXT NOT NULL,
      extension_context_fingerprints_json TEXT NOT NULL,
      agent_context_format_version INTEGER NOT NULL,
      external_instructions_fingerprint TEXT NOT NULL,
      agent_context_fingerprint TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL,
      size_bytes INTEGER NOT NULL
    )
  `);

  const getOrCreate = (
    inputs: GeneratedAgentContextAggregateKeyInputs,
    render: () => GeneratedAgentContextAggregateOutputs,
  ): GeneratedAgentContextAggregateResult => {
    const normalizedInputs = normalizeAggregateInputs(inputs);
    const cacheKey = sha256Json(normalizedInputs);
    const row = db.query(`SELECT * FROM aggregate_cache WHERE cache_key = ?`).get(cacheKey) as
      | CacheRow
      | undefined;
    if (row) {
      const outputs = readValidBlob(cacheKey, normalizedInputs);
      if (outputs) {
        db.query(`UPDATE aggregate_cache SET last_used_at = ? WHERE cache_key = ?`).run(
          now().toISOString(),
          cacheKey,
        );
        return { cacheKey, hit: true, outputs };
      }
      deleteEntry(cacheKey);
    }

    const outputs = render();
    const agentContextFingerprint = sha256Text(outputs.prompt);
    writeBlob(cacheKey, normalizedInputs, outputs, agentContextFingerprint);
    const createdAt = now().toISOString();
    const sizeBytes = directorySize(blobDir(cacheKey));
    db.query(
      `INSERT OR REPLACE INTO aggregate_cache (
        cache_key,
        actor_kind,
        loaded_extension_ids_json,
        available_extension_ids_json,
        extension_context_fingerprints_json,
        agent_context_format_version,
        external_instructions_fingerprint,
        agent_context_fingerprint,
        created_at,
        last_used_at,
        size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      cacheKey,
      normalizedInputs.actorKind,
      JSON.stringify(normalizedInputs.loadedExtensionIds),
      JSON.stringify(normalizedInputs.availableExtensionIds),
      JSON.stringify(normalizedInputs.extensionContextFingerprints),
      normalizedInputs.agentContextFormatVersion,
      normalizedInputs.externalInstructionsFingerprint,
      agentContextFingerprint,
      createdAt,
      createdAt,
      sizeBytes,
    );
    prune();
    return { cacheKey, hit: false, outputs };
  };

  const listRows = (): CacheRow[] =>
    db
      .query(`SELECT * FROM aggregate_cache ORDER BY last_used_at ASC, created_at ASC`)
      .all() as CacheRow[];

  const prune = (): void => {
    const rows = listRows();
    let total = rows.reduce((sum, row) => sum + row.size_bytes, 0);
    if (total <= maxSizeBytes) return;
    const eligibleBefore = now().getTime() - unusedEligibilityMs;
    for (const row of rows) {
      if (total <= maxSizeBytes) break;
      if (Date.parse(row.last_used_at) > eligibleBefore) continue;
      deleteEntry(row.cache_key);
      total -= row.size_bytes;
    }
  };

  function readValidBlob(
    cacheKey: string,
    inputs: GeneratedAgentContextAggregateKeyInputs,
  ): GeneratedAgentContextAggregateOutputs | null {
    const dir = blobDir(cacheKey);
    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) return null;
    let manifest: BlobManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BlobManifest;
    } catch {
      return null;
    }
    if (
      manifest.version !== 1 ||
      manifest.cacheKey !== cacheKey ||
      sha256Json(manifest.inputs) !== sha256Json(inputs)
    ) {
      return null;
    }
    const outputs: Partial<GeneratedAgentContextAggregateOutputs> = {};
    for (const [key, file] of Object.entries(manifest.files) as Array<
      [keyof GeneratedAgentContextAggregateOutputs, { path: string; sha256: string }]
    >) {
      const path = join(dir, file.path);
      if (!existsSync(path)) return null;
      const content = readFileSync(path, "utf8");
      if (sha256Text(content) !== file.sha256) return null;
      outputs[key] = content;
    }
    if (
      outputs.prompt === undefined ||
      outputs.svvyxGuidance === undefined ||
      outputs.commandsDts === undefined ||
      outputs.nativeToolSchemasJson === undefined ||
      sha256Text(outputs.prompt) !== manifest.agentContextFingerprint
    ) {
      return null;
    }
    return outputs as GeneratedAgentContextAggregateOutputs;
  }

  function writeBlob(
    cacheKey: string,
    inputs: GeneratedAgentContextAggregateKeyInputs,
    outputs: GeneratedAgentContextAggregateOutputs,
    agentContextFingerprint: string,
  ): void {
    const dir = blobDir(cacheKey);
    const tempDir = join(blobsRoot, `.tmp-${cacheKey}-${randomUUID()}`);
    rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
    const files: BlobManifest["files"] = {
      prompt: { path: "prompt.md", sha256: sha256Text(outputs.prompt) },
      svvyxGuidance: { path: "svvyx-guidance.md", sha256: sha256Text(outputs.svvyxGuidance) },
      commandsDts: { path: "commands.d.ts", sha256: sha256Text(outputs.commandsDts) },
      nativeToolSchemasJson: {
        path: "native-tool-schemas.json",
        sha256: sha256Text(outputs.nativeToolSchemasJson),
      },
    };
    writeFileSync(join(tempDir, files.prompt.path), outputs.prompt);
    writeFileSync(join(tempDir, files.svvyxGuidance.path), outputs.svvyxGuidance);
    writeFileSync(join(tempDir, files.commandsDts.path), outputs.commandsDts);
    writeFileSync(join(tempDir, files.nativeToolSchemasJson.path), outputs.nativeToolSchemasJson);
    writeFileSync(
      join(tempDir, "manifest.json"),
      `${JSON.stringify(
        {
          version: 1,
          cacheKey,
          inputs,
          agentContextFingerprint,
          files,
        } satisfies BlobManifest,
        null,
        2,
      )}\n`,
    );
    rmSync(dir, { recursive: true, force: true });
    renameSync(tempDir, dir);
  }

  function deleteEntry(cacheKey: string): void {
    db.query(`DELETE FROM aggregate_cache WHERE cache_key = ?`).run(cacheKey);
    rmSync(blobDir(cacheKey), { recursive: true, force: true });
  }

  function blobDir(cacheKey: string): string {
    return join(blobsRoot, cacheKey);
  }

  return {
    getOrCreate,
    listRows,
    prune,
    root,
  };
}

function normalizeAggregateInputs(
  input: GeneratedAgentContextAggregateKeyInputs,
): GeneratedAgentContextAggregateKeyInputs {
  return {
    actorKind: input.actorKind,
    loadedExtensionIds: [...input.loadedExtensionIds],
    availableExtensionIds: [...input.availableExtensionIds],
    extensionContextFingerprints: Object.fromEntries(
      Object.entries(input.extensionContextFingerprints).toSorted(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    generatedAgentContextContentKey: input.generatedAgentContextContentKey,
    agentContextFormatVersion: input.agentContextFormatVersion,
    externalInstructionsFingerprint: input.externalInstructionsFingerprint,
    promptSettingsFingerprint: input.promptSettingsFingerprint,
    workspaceKey: input.workspaceKey,
  };
}

function directorySize(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  return readdirSync(path).reduce((sum, entry) => sum + directorySize(join(path, entry)), 0);
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Json(value: unknown): string {
  return sha256Text(JSON.stringify(sortJson(value)));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}
