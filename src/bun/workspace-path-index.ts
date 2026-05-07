import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { WorkspacePathIndexEntry } from "../shared/workspace-contract";

const IGNORED_DIRS = new Set([".git", "node_modules", ".svvy", ".svelte-kit", "dist", "build"]);
const MAX_FALLBACK_ENTRIES = 8000;

export class WorkspacePathIndex {
  private entries: WorkspacePathIndexEntry[] | null = null;

  constructor(private readonly cwd: string) {}

  list(): WorkspacePathIndexEntry[] {
    if (!this.entries) {
      this.entries = buildWorkspacePathIndex(this.cwd);
    }
    return this.entries;
  }

  refresh(): WorkspacePathIndexEntry[] {
    this.entries = buildWorkspacePathIndex(this.cwd);
    return this.entries;
  }
}

export function buildWorkspacePathIndex(cwd: string): WorkspacePathIndexEntry[] {
  const gitEntries = listGitWorkspacePaths(cwd);
  const entries = gitEntries.length > 0 ? gitEntries : walkWorkspacePaths(cwd);
  return dedupeEntries(entries).toSorted(compareEntries);
}

function listGitWorkspacePaths(cwd: string): WorkspacePathIndexEntry[] {
  const result = spawnSync("git", ["ls-files", "-co", "--exclude-standard"], {
    cwd,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0 || !result.stdout.trim()) return [];

  const entries: WorkspacePathIndexEntry[] = [];
  const folders = new Set<string>();
  for (const rawPath of result.stdout.split(/\r?\n/)) {
    const path = normalizeWorkspacePath(rawPath);
    if (!path) continue;
    entries.push({ kind: "file", workspaceRelativePath: path });
    collectParentFolders(path, folders);
  }
  for (const folder of folders) {
    entries.push({ kind: "folder", workspaceRelativePath: `${folder}/` });
  }
  return entries;
}

function walkWorkspacePaths(cwd: string): WorkspacePathIndexEntry[] {
  const entries: WorkspacePathIndexEntry[] = [];

  const visit = (absoluteDir: string) => {
    if (entries.length >= MAX_FALLBACK_ENTRIES) return;
    for (const dirent of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (entries.length >= MAX_FALLBACK_ENTRIES) return;
      if (dirent.name.startsWith(".") && dirent.name !== ".github") continue;
      if (dirent.isDirectory() && IGNORED_DIRS.has(dirent.name)) continue;

      const absolutePath = join(absoluteDir, dirent.name);
      const relativePath = normalizeWorkspacePath(relative(cwd, absolutePath));
      if (!relativePath) continue;

      if (dirent.isDirectory()) {
        entries.push({ kind: "folder", workspaceRelativePath: `${relativePath}/` });
        visit(absolutePath);
      } else if (dirent.isFile() || statSync(absolutePath).isFile()) {
        entries.push({ kind: "file", workspaceRelativePath: relativePath });
      }
    }
  };

  visit(cwd);
  return entries;
}

function collectParentFolders(path: string, folders: Set<string>): void {
  const parts = path.split("/");
  parts.pop();
  for (let index = 1; index <= parts.length; index += 1) {
    folders.add(parts.slice(0, index).join("/"));
  }
}

function dedupeEntries(entries: WorkspacePathIndexEntry[]): WorkspacePathIndexEntry[] {
  const seen = new Set<string>();
  const next: WorkspacePathIndexEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.workspaceRelativePath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(entry);
  }
  return next;
}

function compareEntries(left: WorkspacePathIndexEntry, right: WorkspacePathIndexEntry): number {
  if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
  return left.workspaceRelativePath.localeCompare(right.workspaceRelativePath);
}

function normalizeWorkspacePath(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.includes("../")) return null;
  return normalized;
}
