/**
 * The version-control surface: working-tree status, a change list, and the
 * bookmarks/branches the repo sits on. Modeled to cover both git and jujutsu
 * (jj), the two backends the VCS workflow drives, so one card and one canvas
 * render either. Seeded with a believable demo tree like the other feature
 * cards (apps/smithers has no gateway yet); the workflow UI in
 * `.smithers/ui/vcs.tsx` is the one wired to real git/jj.
 *
 * Everything below the seed data is pure, so the parser and the staging/commit
 * reducers are unit-tested without a DOM (see vcsDomain.test.ts).
 */
export type VcsBackend = "git" | "jj";

export type ChangeStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

/** One path in the working tree, with its line delta and staged flag. */
export type Change = {
  path: string;
  status: ChangeStatus;
  staged: boolean;
  add: number;
  del: number;
};

/** A git branch or jj bookmark, with its distance from the trunk. */
export type Bookmark = {
  name: string;
  /** Short commit / change id it points at. */
  ref: string;
  /** The bookmark the working copy is currently on. */
  current: boolean;
  ahead: number;
  behind: number;
};

export type WorkingTree = {
  backend: VcsBackend;
  branch: string;
  /** Short id of the working-copy commit (git) or change (jj). */
  head: string;
  changes: Change[];
  bookmarks: Bookmark[];
};

export const STATUS_GLYPH: Record<ChangeStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  untracked: "?",
};

export const STATUS_LABEL: Record<ChangeStatus, string> = {
  added: "added",
  modified: "modified",
  deleted: "deleted",
  renamed: "renamed",
  untracked: "untracked",
};

/** A working tree's headline counts, derived once for the header and summaries. */
export type TreeSummary = {
  total: number;
  staged: number;
  unstaged: number;
  untracked: number;
  add: number;
  del: number;
};

export function summarize(tree: WorkingTree): TreeSummary {
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let add = 0;
  let del = 0;
  for (const change of tree.changes) {
    add += change.add;
    del += change.del;
    if (change.status === "untracked") untracked += 1;
    else if (change.staged) staged += 1;
    else unstaged += 1;
  }
  return { total: tree.changes.length, staged, unstaged, untracked, add, del };
}

/** Flip one path's staged flag, returning a new tree (untracked files can stage). */
export function toggleStaged(tree: WorkingTree, path: string): WorkingTree {
  return {
    ...tree,
    changes: tree.changes.map((change) =>
      change.path === path ? { ...change, staged: !change.staged } : change,
    ),
  };
}

/** Stage every change (`git add -A` / `jj` tracks everything already). */
export function stageAll(tree: WorkingTree): WorkingTree {
  return { ...tree, changes: tree.changes.map((change) => ({ ...change, staged: true })) };
}

export function unstageAll(tree: WorkingTree): WorkingTree {
  return { ...tree, changes: tree.changes.map((change) => ({ ...change, staged: false })) };
}

/** FNV-1a, so a commit advances `head` to a stable id without Math.random. */
export function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Apply a commit: drop the staged changes, advance `head` to a fresh id, and
 * push the current bookmark one commit ahead of the trunk. Untracked and
 * unstaged work stays in the tree, exactly like a real partial commit.
 */
export function applyCommit(tree: WorkingTree): WorkingTree {
  const staged = tree.changes.filter((change) => change.staged && change.status !== "untracked");
  if (staged.length === 0) return tree;
  const head = shortHash(tree.head + staged.map((change) => change.path).join(",")).slice(0, 8);
  return {
    ...tree,
    head,
    changes: tree.changes.filter((change) => !(change.staged && change.status !== "untracked")),
    bookmarks: tree.bookmarks.map((bookmark) =>
      bookmark.current ? { ...bookmark, ref: head, ahead: bookmark.ahead + 1 } : bookmark,
    ),
  };
}

function statusFromCode(code: string): ChangeStatus {
  switch (code) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "?":
      return "untracked";
    default:
      return "modified";
  }
}

/**
 * Parse `git status --porcelain=v1` into changes. Each line is `XY path`, where
 * X is the index (staged) state and Y the working-tree state; `??` is untracked.
 * A path can be both staged and modified again, so we surface the staged entry
 * when X is set and the worktree entry otherwise.
 */
export function parseGitStatus(porcelain: string): Change[] {
  const changes: Change[] = [];
  for (const raw of porcelain.split("\n")) {
    if (raw.length < 4) continue;
    const x = raw[0];
    const y = raw[1];
    let path = raw.slice(3).trim();
    if (path.includes(" -> ")) path = path.split(" -> ")[1];
    const untracked = x === "?" && y === "?";
    const staged = !untracked && x !== " ";
    const code = untracked ? "?" : staged ? x : y;
    changes.push({
      path,
      status: statusFromCode(code),
      staged,
      add: 0,
      del: 0,
    });
  }
  return changes;
}

export const SEEDED_GIT_TREE: WorkingTree = {
  backend: "git",
  branch: "feat/vcs-dashboard",
  head: "a1c3e8f0",
  changes: [
    { path: "apps/smithers/src/vcs/VcsCanvas.tsx", status: "added", staged: true, add: 184, del: 0 },
    { path: "apps/smithers/src/vcs/vcsStore.ts", status: "added", staged: true, add: 96, del: 0 },
    { path: "apps/smithers/src/cards/CardView.tsx", status: "modified", staged: false, add: 4, del: 0 },
    { path: "apps/smithers/src/app/runSlash.ts", status: "modified", staged: false, add: 6, del: 1 },
    { path: "apps/smithers/src/legacy/Changes.swift", status: "deleted", staged: false, add: 0, del: 212 },
    { path: "apps/smithers/src/vcs/notes.md", status: "untracked", staged: false, add: 12, del: 0 },
  ],
  bookmarks: [
    { name: "feat/vcs-dashboard", ref: "a1c3e8f0", current: true, ahead: 3, behind: 0 },
    { name: "main", ref: "7d90b211", current: false, ahead: 0, behind: 0 },
    { name: "feat/usage-limits", ref: "5f2a9c14", current: false, ahead: 7, behind: 2 },
  ],
};

export const SEEDED_JJ_TREE: WorkingTree = {
  backend: "jj",
  branch: "vcs-dashboard@",
  head: "qpvuntsm",
  changes: [
    { path: "apps/smithers/src/vcs/VcsCanvas.tsx", status: "added", staged: true, add: 184, del: 0 },
    { path: "apps/smithers/src/vcs/vcsStore.ts", status: "added", staged: true, add: 96, del: 0 },
    { path: "apps/smithers/src/cards/CardView.tsx", status: "modified", staged: true, add: 4, del: 0 },
    { path: "apps/smithers/src/app/runSlash.ts", status: "modified", staged: true, add: 6, del: 1 },
  ],
  bookmarks: [
    { name: "vcs-dashboard", ref: "qpvuntsm", current: true, ahead: 1, behind: 0 },
    { name: "main", ref: "zzzzzzzz", current: false, ahead: 0, behind: 0 },
  ],
};

export const SEEDED_TREES: Record<VcsBackend, WorkingTree> = {
  git: SEEDED_GIT_TREE,
  jj: SEEDED_JJ_TREE,
};
