import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface TempWorkspace {
  root: string;
  path(relativePath: string): string;
  createWorktree(name: string): Promise<string>;
  write(relativePath: string, content: string): Promise<string>;
  read(relativePath: string): Promise<string>;
  cleanup(): Promise<void>;
}

export async function createTempWorkspace(prefix = "hellm-"): Promise<TempWorkspace> {
  const root = await mkdtemp(join(tmpdir(), prefix));

  return {
    root,
    path(relativePath) {
      return resolve(root, relativePath);
    },
    async createWorktree(name) {
      const path = resolve(root, "worktrees", name);
      await mkdir(path, { recursive: true });
      return path;
    },
    async write(relativePath, content) {
      const path = resolve(root, relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
      return path;
    },
    async read(relativePath) {
      return readFile(resolve(root, relativePath), "utf8");
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function withTempWorkspace<T>(
  fn: (workspace: TempWorkspace) => Promise<T>,
): Promise<T> {
  const workspace = await createTempWorkspace();
  try {
    return await fn(workspace);
  } finally {
    await workspace.cleanup();
  }
}
