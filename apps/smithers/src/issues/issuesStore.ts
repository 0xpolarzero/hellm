import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import {
  type Issue as PlatformIssue,
  listIssues,
} from "../jjhub/issues";
import { getPlatformBaseUrl } from "../jjhub/platformBaseUrl";
import { PlatformError } from "../jjhub/platformJson";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  closeIssue,
  createIssue,
  reopenIssue,
  SEEDED_ISSUES,
  type Issue,
  type IssueFilter,
} from "./issues";

/**
 * The issues store: the seeded backlog plus the selection, filter, and create
 * form state the card and canvas read. Mutations post feedback the same way the
 * vcs store does, a chat line and a transient toast, since this PWA has no
 * gateway yet.
 */
export type IssuesHydrationStatus = "idle" | "loading" | "ok" | "error";

export type RepoContext = { owner: string; repo: string };

type IssuesState = {
  issues: Issue[];
  selectedId: string | null;
  filter: IssueFilter;
  creating: boolean;
  draftTitle: string;
  draftBody: string;
  hydrationStatus: IssuesHydrationStatus;
  hydrationError: string | null;
  hydrationSource: "seed" | "platform";
  /** The repo the user has bound the issues card to, or null when offline. */
  repoContext: RepoContext | null;
  select: (id: string) => void;
  setFilter: (filter: IssueFilter) => void;
  openCreate: () => void;
  cancelCreate: () => void;
  setDraftTitle: (value: string) => void;
  setDraftBody: (value: string) => void;
  submitCreate: () => void;
  close: (number: number) => void;
  reopen: (number: number) => void;
  hydrateFromPlatform: (owner: string, repo: string, signal?: AbortSignal) => Promise<void>;
  /**
   * Bind the issues card to `owner/repo` and pull issues from Plue. The first
   * real consumer of `hydrateFromPlatform`: triggered by the canvas's repo
   * selector so the live path is not dormant.
   */
  selectRepoContext: (owner: string, repo: string) => Promise<void>;
};

/**
 * Map a wire Plue issue onto the seeded shape this card already renders, so
 * the store stays one shape regardless of source. The display surface is the
 * same set of fields; we just drop wire-only metadata (avatar URLs, dates,
 * etc.) since the card doesn't show them yet.
 */
function fromPlatformIssue(issue: PlatformIssue): Issue {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.map((l) => l.name),
    assignees: issue.assignees.map((a) => a.username),
    commentCount: issue.commentCount,
  };
}

export const useIssuesStore = create<IssuesState>((set, get) => ({
  issues: SEEDED_ISSUES,
  selectedId: null,
  filter: "open",
  creating: false,
  draftTitle: "",
  draftBody: "",
  hydrationStatus: "idle",
  hydrationError: null,
  hydrationSource: "seed",
  repoContext: null,

  select: (id) => set({ selectedId: id }),

  setFilter: (filter) => set({ filter }),

  openCreate: () => set({ creating: true }),

  cancelCreate: () => set({ creating: false, draftTitle: "", draftBody: "" }),

  setDraftTitle: (value) => set({ draftTitle: value }),

  setDraftBody: (value) => set({ draftBody: value }),

  submitCreate: () => {
    const { issues, draftTitle, draftBody } = get();
    const title = draftTitle.trim();
    if (title === "") return;
    const { issues: next, created } = createIssue(issues, { title, body: draftBody.trim() });
    set({
      issues: next,
      selectedId: created.id,
      filter: "open",
      creating: false,
      draftTitle: "",
      draftBody: "",
    });
    useChatStore.getState().say(`Opened issue #${created.number}: ${created.title}`);
    useNotificationsStore.getState().notify({
      title: "Issue opened",
      detail: `#${created.number} · ${created.title}`,
      kind: "transient",
      command: "chat",
    });
  },

  close: (number) => {
    const { issues } = get();
    const target = issues.find((issue) => issue.number === number);
    if (!target) return;
    set({ issues: closeIssue(issues, number) });
    useChatStore.getState().say(`Closed issue #${number}: ${target.title}`);
    useNotificationsStore.getState().notify({
      title: "Issue closed",
      detail: `#${number} · ${target.title}`,
      kind: "transient",
      command: "chat",
    });
  },

  reopen: (number) => {
    const { issues } = get();
    const target = issues.find((issue) => issue.number === number);
    if (!target) return;
    set({ issues: reopenIssue(issues, number) });
    useChatStore.getState().say(`Reopened issue #${number}: ${target.title}`);
    useNotificationsStore.getState().notify({
      title: "Issue reopened",
      detail: `#${number} · ${target.title}`,
      kind: "transient",
      command: "chat",
    });
  },

  /**
   * Pull issues for `owner/repo` from real Plue and replace the seeded list.
   * A no-op when no platform base URL is configured: offline/dev mode keeps
   * the seeded backlog. Errors (network, 401, 4xx) leave the existing list in
   * place and surface on `hydrationError` so the canvas can render a banner.
   */
  hydrateFromPlatform: async (owner, repo, signal) => {
    if (!getPlatformBaseUrl()) {
      set({ hydrationStatus: "ok", hydrationError: null, hydrationSource: "seed" });
      return;
    }
    set({ hydrationStatus: "loading", hydrationError: null });
    try {
      const page = await listIssues(owner, repo, { state: "all", limit: 30, signal });
      if (signal?.aborted) return;
      set({
        issues: page.issues.map(fromPlatformIssue),
        selectedId: null,
        hydrationStatus: "ok",
        hydrationError: null,
        hydrationSource: "platform",
      });
    } catch (error) {
      if (signal?.aborted) return;
      const message =
        error instanceof PlatformError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to load issues";
      set({ hydrationStatus: "error", hydrationError: message });
    }
  },

  selectRepoContext: async (owner, repo) => {
    set({ repoContext: { owner, repo } });
    await get().hydrateFromPlatform(owner, repo);
  },
}));
