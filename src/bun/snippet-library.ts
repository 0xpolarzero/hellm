import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import {
  parseSnippetMarkdown,
  type DiscoveredSnippet,
  type ExternalSnippetSource,
  type ManagedSnippet,
  type SnippetScope,
  type SnippetsReadModel,
} from "../shared/snippets";

export interface DiscoverSnippetsInput {
  homeDir: string;
  workspaceDir: string;
}

export function discoverSnippets(input: DiscoverSnippetsInput): DiscoveredSnippet[] {
  const snippets: DiscoveredSnippet[] = [];
  snippets.push(
    ...discoverMarkdownFiles({
      root: join(input.homeDir, ".claude", "commands"),
      recursive: true,
      source: "claude",
      scope: "user",
    }),
    ...discoverMarkdownFiles({
      root: join(input.workspaceDir, ".claude", "commands"),
      recursive: true,
      source: "claude",
      scope: "workspace",
    }),
    ...discoverMarkdownFiles({
      root: join(input.homeDir, ".pi", "agent", "prompts"),
      recursive: false,
      source: "pi",
      scope: "user",
    }),
    ...discoverMarkdownFiles({
      root: join(input.workspaceDir, ".pi", "prompts"),
      recursive: false,
      source: "pi",
      scope: "workspace",
    }),
  );
  return snippets.toSorted(
    (a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path),
  );
}

export function buildSnippetsReadModel(input: {
  managed: readonly ManagedSnippet[];
  discovered: readonly DiscoveredSnippet[];
}): SnippetsReadModel {
  const managed = [...input.managed].toSorted(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  const discovered = [...input.discovered].toSorted(
    (a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path),
  );
  return {
    managed,
    discovered,
    snippets: [...managed, ...discovered],
  };
}

function discoverMarkdownFiles(input: {
  root: string;
  recursive: boolean;
  source: ExternalSnippetSource;
  scope: SnippetScope;
}): DiscoveredSnippet[] {
  return listMarkdownFiles(input.root, input.recursive).map((path) => {
    const parsed = parseSnippetMarkdown(readFileSync(path, "utf8"));
    return {
      id: `${input.source}:${input.scope}:${path}`,
      source: input.source,
      scope: input.scope,
      title: getSnippetTitle(input.root, path, input.source),
      path,
      body: parsed.body,
      metadata: parsed.metadata,
      enabled: true,
      readOnly: true,
    };
  });
}

export function applySnippetEnablement<T extends DiscoveredSnippet | ManagedSnippet>(
  snippets: readonly T[],
  disabledSnippetIds: readonly string[],
): T[] {
  const disabledIds = new Set(disabledSnippetIds);
  return snippets.map((snippet) => ({
    ...snippet,
    enabled: !disabledIds.has(snippet.id),
  }));
}

function listMarkdownFiles(root: string, recursive: boolean): string[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...listMarkdownFiles(path, recursive));
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files.toSorted((a, b) => a.localeCompare(b));
}

function getSnippetTitle(root: string, path: string, source: ExternalSnippetSource): string {
  const rawTitle =
    source === "claude"
      ? relative(root, path).replaceAll(sep, "/").replace(/\.md$/, "")
      : basename(path, ".md");
  return rawTitle.trim() || basename(path, ".md");
}
