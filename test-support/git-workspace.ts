import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createTempWorkspace,
  type TempWorkspace,
} from "./temp-workspace";

export interface TempGitWorkspace extends TempWorkspace {
  git(args: string[], cwd?: string): string;
  commitAll(message: string, cwd?: string): void;
  createLinkedWorktree(name: string): Promise<string>;
}

export function hasGit(): boolean {
  const result = spawnSync("git", ["--version"], { encoding: "utf8" });
  return result.status === 0;
}

export async function createTempGitWorkspace(
  prefix = "hellm-git-",
): Promise<TempGitWorkspace> {
  const workspace = await createTempWorkspace(prefix);
  const git = (args: string[], cwd = workspace.root): string => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${result.stderr || result.stdout || "unknown error"}`,
      );
    }
    return result.stdout.trim();
  };

  git(["init"], workspace.root);
  git(["config", "user.email", "hellm-tests@example.com"], workspace.root);
  git(["config", "user.name", "hellm tests"], workspace.root);
  await writeFile(resolve(workspace.root, "README.md"), "hellm test repo\n", "utf8");
  git(["add", "README.md"], workspace.root);
  git(["commit", "-m", "chore: initialize temp repo"], workspace.root);

  return {
    ...workspace,
    git,
    commitAll(message, cwd = workspace.root) {
      git(["add", "-A"], cwd);
      git(["commit", "-m", message], cwd);
    },
    async createLinkedWorktree(name) {
      const path = resolve(workspace.root, "worktrees", name);
      await mkdir(resolve(workspace.root, "worktrees"), { recursive: true });
      git(["worktree", "add", path, "-b", name], workspace.root);
      return path;
    },
  };
}
