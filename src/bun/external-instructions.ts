import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  DEFAULT_EXTERNAL_INSTRUCTION_ACTORS,
  type ExternalInstructionControl,
  type ExternalInstructionGlobalRootSetting,
  type ExternalInstructionsSettings,
} from "../shared/agent-settings";
import type { GeneratedAgentContextExternalSource } from "../shared/generated-agent-context";

const EXTERNAL_INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

export interface DiscoverExternalInstructionSourcesOptions {
  cwd: string;
  globalRoots?: readonly (string | ExternalInstructionGlobalRootSetting)[];
  settings?: ExternalInstructionsSettings;
  workspaceKey?: string;
}

export function discoverExternalInstructionSources(
  options: DiscoverExternalInstructionSourcesOptions,
): GeneratedAgentContextExternalSource[] {
  const sources: GeneratedAgentContextExternalSource[] = [];
  const settings = options.settings;
  const workspaceKey = options.workspaceKey ?? options.cwd;
  const globalRoots = options.globalRoots ?? settings?.globalRoots ?? [];
  for (const root of globalRoots) {
    const normalized = normalizeGlobalRoot(root);
    if (!normalized.enabled) continue;
    sources.push(
      ...readExternalInstructionsInDirectory(normalized.path, {
        controls: settings?.globalControls,
        sourceGroup: normalized.kind === "custom" ? "custom_global_root" : "builtin_global_root",
        rootId: normalized.id,
        rootLabel: normalized.label,
      }),
    );
  }
  for (const directory of workspaceAncestorChain(options.cwd)) {
    sources.push(
      ...readExternalInstructionsInDirectory(directory, {
        controls: settings?.workspaceControls?.[workspaceKey],
        sourceGroup: "workspace_chain",
      }),
    );
  }
  return sources.map((source, order) => ({
    ...source,
    id: `${order}:${source.path.replaceAll("\\", "/")}`,
    order,
  }));
}

function workspaceAncestorChain(cwd: string): string[] {
  const chain: string[] = [];
  let current = resolve(cwd);
  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return chain.toReversed();
}

function readExternalInstructionsInDirectory(
  directory: string,
  options: {
    controls?: Record<string, ExternalInstructionControl>;
    rootId?: string;
    rootLabel?: string;
    sourceGroup: GeneratedAgentContextExternalSource["sourceGroup"];
  },
): GeneratedAgentContextExternalSource[] {
  const candidates = EXTERNAL_INSTRUCTION_FILES.flatMap(
    (fileName): GeneratedAgentContextExternalSource[] => {
      const path = resolve(join(expandHome(directory), fileName));
      if (!existsSync(path)) {
        return [];
      }
      try {
        if (!statSync(path).isFile()) return [];
        const content = readFileSync(path, "utf8");
        const source: GeneratedAgentContextExternalSource = {
          id: "",
          kind: fileName,
          title: fileName,
          path,
          content,
          contentHash: createHash("sha256").update(content).digest("hex"),
          order: 0,
          enabled: false,
          actors: [...DEFAULT_EXTERNAL_INSTRUCTION_ACTORS],
          sourceGroup: options.sourceGroup,
          ...(options.rootId ? { rootId: options.rootId } : {}),
          ...(options.rootLabel ? { rootLabel: options.rootLabel } : {}),
          readStatus: { status: "readable" },
        };
        return [source];
      } catch (error) {
        const source: GeneratedAgentContextExternalSource = {
          id: "",
          kind: fileName,
          title: fileName,
          path,
          content: "",
          contentHash: "",
          order: 0,
          enabled: false,
          actors: [...DEFAULT_EXTERNAL_INSTRUCTION_ACTORS],
          sourceGroup: options.sourceGroup,
          ...(options.rootId ? { rootId: options.rootId } : {}),
          ...(options.rootLabel ? { rootLabel: options.rootLabel } : {}),
          readStatus: {
            status: "unreadable",
            error: error instanceof Error ? error.message : "Unable to read external instruction.",
          },
        };
        return [source];
      }
    },
  );
  const hasAgents = candidates.some((source) => source.kind === "AGENTS.md");

  return candidates.map((source) =>
    applyExternalInstructionControl(
      {
        ...source,
        enabled: source.kind === "AGENTS.md" || !hasAgents,
      },
      options.controls?.[source.path] ?? options.controls?.[normalizedControlPath(source.path)],
    ),
  );
}

function applyExternalInstructionControl(
  source: GeneratedAgentContextExternalSource,
  control: ExternalInstructionControl | undefined,
): GeneratedAgentContextExternalSource {
  if (!control) return source;
  return {
    ...source,
    enabled: control.enabled,
    actors: control.actors.filter((actor) => DEFAULT_EXTERNAL_INSTRUCTION_ACTORS.includes(actor)),
  };
}

function normalizeGlobalRoot(
  root: string | ExternalInstructionGlobalRootSetting,
): ExternalInstructionGlobalRootSetting {
  if (typeof root === "string") {
    return {
      id: normalizedControlPath(root),
      kind: "custom",
      label: root,
      path: expandHome(root),
      enabled: true,
    };
  }
  return {
    ...root,
    path: expandHome(root.path),
  };
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function normalizedControlPath(path: string): string {
  return resolve(expandHome(path)).replaceAll("\\", "/");
}
