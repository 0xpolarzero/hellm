import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import { listLandings, type Landing as PlatformLanding } from "../jjhub/landings";
import { getPlatformBaseUrl } from "../jjhub/platformBaseUrl";
import { PlatformError } from "../jjhub/platformJson";
import {
  createLanding,
  landLanding,
  reviewLanding,
  SEEDED_LANDINGS,
  type DetailTab,
  type Landing,
  type LandingFilter,
  type ReviewAction,
} from "./landings";

export type LandingsHydrationStatus = "idle" | "loading" | "ok" | "error";

export type RepoContext = { owner: string; repo: string };

/**
 * The landings store: the seeded stack plus all view state (selection, filter,
 * detail tab, the review note, and the create form). Mutations replay the jjhub
 * workflow's review/land/create verbs as a chat line plus a toast, the shape
 * launchRun uses. The seed stays until `selectRepoContext` binds the card to a
 * repo, which pulls live landing requests from Plue (a no-op offline).
 */
type LandingsState = {
  landings: Landing[];
  selectedId: string | null;
  filter: LandingFilter;
  tab: DetailTab;
  reviewDraft: string;
  createOpen: boolean;
  newTitle: string;
  newBody: string;
  newTarget: string;
  select: (id: string) => void;
  setFilter: (filter: LandingFilter) => void;
  setTab: (tab: DetailTab) => void;
  setReviewDraft: (value: string) => void;
  review: (action: ReviewAction) => void;
  land: () => void;
  openCreate: () => void;
  cancelCreate: () => void;
  setNewTitle: (value: string) => void;
  setNewBody: (value: string) => void;
  setNewTarget: (value: string) => void;
  submitCreate: () => void;
  hydrationStatus: LandingsHydrationStatus;
  hydrationError: string | null;
  hydrationSource: "seed" | "platform";
  /** The repo the user has bound the landings card to, or null when offline. */
  repoContext: RepoContext | null;
  hydrateFromPlatform: (owner: string, repo: string, signal?: AbortSignal) => Promise<void>;
  selectRepoContext: (owner: string, repo: string) => Promise<void>;
};

/** Map a Plue landing-request payload onto the seeded card's view model. Detail-
 *  only fields (diff, checks, review status) aren't in the list page, so they
 *  default empty until a detail fetch fills them. */
function fromPlatformLanding(landing: PlatformLanding): Landing {
  return {
    id: landing.id,
    number: landing.number,
    title: landing.title,
    description: landing.body,
    state: landing.draft ? "draft" : landing.state,
    targetBranch: landing.baseRef,
    author: landing.user?.username ?? "unknown",
    createdAt: landing.createdAt ?? "",
    reviewStatus: "pending",
    diff: "",
    checks: "",
  };
}

export const useLandingsStore = create<LandingsState>((set, get) => ({
  landings: SEEDED_LANDINGS,
  selectedId: SEEDED_LANDINGS[0]?.id ?? null,
  filter: "open",
  tab: "info",
  reviewDraft: "",
  createOpen: false,
  newTitle: "",
  newBody: "",
  newTarget: "",
  hydrationStatus: "idle",
  hydrationError: null,
  hydrationSource: "seed",
  repoContext: null,

  select: (id) => set({ selectedId: id, tab: "info" }),

  setFilter: (filter) => set({ filter }),

  setTab: (tab) => set({ tab }),

  setReviewDraft: (reviewDraft) => set({ reviewDraft }),

  review: (action) => {
    const { landings, selectedId, reviewDraft } = get();
    const selected = landings.find((landing) => landing.id === selectedId);
    if (!selected) return;
    const chat = useChatStore.getState();
    const notify = useNotificationsStore.getState().notify;
    const note = reviewDraft.trim();

    set({ landings: reviewLanding(landings, selected.number, action), reviewDraft: "" });

    const verb =
      action === "approve" ? "Approved" : action === "request_changes" ? "Requested changes on" : "Commented on";
    chat.say(`${verb} #${selected.number} \`${selected.title}\`.${note ? `\n\n> ${note}` : ""}`);
    notify({
      title: `${verb} #${selected.number}`,
      detail: selected.title,
      kind: "transient",
      command: "chat",
    });
  },

  land: () => {
    const { landings, selectedId } = get();
    const selected = landings.find((landing) => landing.id === selectedId);
    if (!selected) return;
    const chat = useChatStore.getState();
    const notify = useNotificationsStore.getState().notify;

    set({ landings: landLanding(landings, selected.number) });

    chat.say(`Landed #${selected.number} \`${selected.title}\` onto \`${selected.targetBranch}\`.`);
    notify({
      title: `Landed #${selected.number}`,
      detail: selected.targetBranch,
      kind: "transient",
      command: "chat",
    });
  },

  openCreate: () => set({ createOpen: true }),

  cancelCreate: () => set({ createOpen: false, newTitle: "", newBody: "", newTarget: "" }),

  setNewTitle: (newTitle) => set({ newTitle }),

  setNewBody: (newBody) => set({ newBody }),

  setNewTarget: (newTarget) => set({ newTarget }),

  submitCreate: () => {
    const { landings, newTitle, newBody, newTarget } = get();
    const title = newTitle.trim();
    if (title === "") return;
    const chat = useChatStore.getState();
    const notify = useNotificationsStore.getState().notify;

    const { landings: next, created } = createLanding(landings, {
      title,
      description: newBody.trim(),
      target: newTarget.trim(),
    });
    set({
      landings: next,
      selectedId: created.id,
      tab: "info",
      filter: "open",
      createOpen: false,
      newTitle: "",
      newBody: "",
      newTarget: "",
    });

    chat.say(`Opened #${created.number} \`${created.title}\` onto \`${created.targetBranch}\`.`);
    notify({
      title: `Opened #${created.number}`,
      detail: created.title,
      kind: "transient",
      command: "chat",
    });
  },

  /**
   * Pull landing requests for `owner/repo` from real Plue and replace the seeded
   * stack. A no-op when no platform base URL is configured, so offline/dev keeps
   * the seed. Errors leave the existing list in place and surface on
   * `hydrationError` for the canvas to render a banner.
   */
  hydrateFromPlatform: async (owner, repo, signal) => {
    if (!getPlatformBaseUrl()) {
      set({ hydrationStatus: "ok", hydrationError: null, hydrationSource: "seed" });
      return;
    }
    set({ hydrationStatus: "loading", hydrationError: null });
    try {
      const page = await listLandings(owner, repo, { state: "all", limit: 30, signal });
      if (signal?.aborted) return;
      const landings = page.landings.map(fromPlatformLanding);
      set({
        landings,
        selectedId: landings[0]?.id ?? null,
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
            : "Failed to load landings";
      set({ hydrationStatus: "error", hydrationError: message });
    }
  },

  selectRepoContext: async (owner, repo) => {
    set({ repoContext: { owner, repo } });
    await get().hydrateFromPlatform(owner, repo);
  },
}));
