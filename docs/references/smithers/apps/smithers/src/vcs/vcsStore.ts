import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  applyCommit,
  SEEDED_TREES,
  stageAll,
  summarize,
  toggleStaged,
  type VcsBackend,
  type WorkingTree,
} from "./vcs";

/**
 * The action bar's verbs. Each one maps to a sub-workflow the VCS workflow
 * dispatches: `status`/`stage-all`/`push` are deterministic git/jj calls,
 * `commit` and `rebase-plan` hand off to an agent. Here in the gateway-less PWA
 * we replay that as a chat line plus a toast, the same shape `launchRun` uses.
 */
export type VcsActionId = "status" | "stage-all" | "commit" | "rebase-plan" | "push";

type VcsState = {
  backend: VcsBackend;
  tree: WorkingTree;
  /** The action currently running, so the bar can show a pending verb. */
  pending: VcsActionId | null;
  setBackend: (backend: VcsBackend) => void;
  toggleStage: (path: string) => void;
  runAction: (action: VcsActionId) => void;
};

function cli(tree: WorkingTree): string {
  return tree.backend;
}

export const useVcsStore = create<VcsState>((set, get) => ({
  backend: "git",
  tree: SEEDED_TREES.git,
  pending: null,

  setBackend: (backend) => set({ backend, tree: SEEDED_TREES[backend] }),

  toggleStage: (path) => set((state) => ({ tree: toggleStaged(state.tree, path) })),

  runAction: (action) => {
    const { tree } = get();
    const chat = useChatStore.getState();
    const notify = useNotificationsStore.getState().notify;
    const tool = cli(tree);

    switch (action) {
      case "status": {
        const s = summarize(tree);
        const unstaged = s.unstaged + s.untracked;
        chat.say(
          `\`${tool} status\` — ${s.total} changed file${s.total === 1 ? "" : "s"} on \`${tree.branch}\` ` +
            `(${s.staged} staged, ${unstaged} unstaged).`,
        );
        return;
      }
      case "stage-all": {
        set({ tree: stageAll(tree) });
        chat.say(`Staged every change (\`${tool === "jj" ? "jj" : "git add -A"}\`).`);
        return;
      }
      case "commit": {
        const s = summarize(tree);
        if (s.staged === 0) {
          chat.say("Nothing staged to commit yet. Stage some files first.");
          return;
        }
        const committed = applyCommit(tree);
        set({ tree: committed });
        const message = `✨ feat(vcs): add ${s.staged} change${s.staged === 1 ? "" : "s"} to the dashboard`;
        chat.say(
          `An agent read the staged diff and wrote a commit message:\n\n` +
            `> ${message}\n\n` +
            `Committed as \`${committed.head}\` on \`${committed.branch}\`.`,
        );
        notify({
          title: "Commit created",
          detail: `${committed.head} · ${tool}`,
          kind: "transient",
          command: "chat",
        });
        return;
      }
      case "rebase-plan": {
        const onto = tree.bookmarks.find((bookmark) => bookmark.name === "main");
        const ahead = tree.bookmarks.find((bookmark) => bookmark.current)?.ahead ?? 0;
        chat.say(
          `An agent planned a rebase of \`${tree.branch}\` onto \`main\` (${ahead} commit${ahead === 1 ? "" : "s"} ahead):\n\n` +
            `1. \`${tool === "jj" ? "jj rebase -d main" : "git rebase --onto main"}\` to move the branch.\n` +
            `2. Replay each commit; the dashboard files have no conflicts.\n` +
            `3. Re-run \`pnpm typecheck\` to confirm the rebase kept the gate green.` +
            (onto && onto.ref ? `\n4. Fast-forward \`main\` (\`${onto.ref}\`) once verified.` : ""),
        );
        return;
      }
      case "push": {
        chat.say(`Pushed \`${tree.branch}\` to \`origin\` (\`${tool} push\`).`);
        notify({
          title: "Pushed to origin",
          detail: tree.branch,
          kind: "transient",
          command: "chat",
        });
        return;
      }
    }
  },
}));
