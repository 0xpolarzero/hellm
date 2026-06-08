import { create } from "zustand";
import { useChatStore } from "../chat/chatStore";
import { useNotificationsStore } from "../notifications/notificationsStore";
import {
  addAccount,
  findProvider,
  registerAccount,
  removeAccount,
  SEEDED_ACCOUNTS,
  validateDraft,
  type Account,
  type AccountDraft,
  type AgentFilter,
} from "./agents";

/**
 * The agents-registry store: the seeded detection pass plus the selection,
 * filter, and registration-drawer draft the card and canvas read. Mutations
 * echo feedback the way the vcs/issues stores do — a chat line plus a transient
 * toast — since this PWA has no gateway yet. Zero useState anywhere; the canvas
 * reads slices via selectors and derives the rest in its render body.
 */
type AgentsState = {
  accounts: Account[];
  selectedLabel: string | null;
  filter: AgentFilter;
  /** The registration drawer is open. */
  registering: boolean;
  draftProviderId: string | null;
  draftLabel: string;
  draftConfigDir: string;
  draftApiKey: string;
  draftModel: string;
  draftForce: boolean;

  select: (label: string) => void;
  setFilter: (filter: AgentFilter) => void;
  openRegister: () => void;
  cancelRegister: () => void;
  pickProvider: (providerId: string) => void;
  setDraftLabel: (value: string) => void;
  setDraftConfigDir: (value: string) => void;
  setDraftApiKey: (value: string) => void;
  setDraftModel: (value: string) => void;
  toggleDraftForce: () => void;
  submitRegister: () => void;
  remove: (label: string) => void;
  test: (label: string) => void;
  refresh: () => void;
};

/** Clear every draft field back to its empty default (drawer close / submit). */
const EMPTY_DRAFT = {
  draftProviderId: null as string | null,
  draftLabel: "",
  draftConfigDir: "",
  draftApiKey: "",
  draftModel: "",
  draftForce: false,
};

export const useAgentsStore = create<AgentsState>((set, get) => ({
  accounts: SEEDED_ACCOUNTS,
  selectedLabel: null,
  filter: "available",
  registering: false,
  ...EMPTY_DRAFT,

  select: (label) => set({ selectedLabel: label }),

  setFilter: (filter) => set({ filter }),

  openRegister: () =>
    set({
      registering: true,
      // Preselect the first subscription provider so the drawer renders a field.
      draftProviderId: "claude-code",
      draftLabel: "",
      draftConfigDir: "",
      draftApiKey: "",
      draftModel: "",
      draftForce: false,
    }),

  cancelRegister: () => set({ registering: false, ...EMPTY_DRAFT }),

  pickProvider: (providerId) => {
    const provider = findProvider(providerId);
    // Reset the auth field that no longer applies, so a stale value never leaks
    // from a subscription provider into an api-key one (or vice versa).
    set({
      draftProviderId: providerId,
      draftConfigDir: provider?.authMode === "subscription" ? get().draftConfigDir : "",
      draftApiKey: provider?.authMode === "api-key" ? get().draftApiKey : "",
    });
  },

  setDraftLabel: (value) => set({ draftLabel: value }),
  setDraftConfigDir: (value) => set({ draftConfigDir: value }),
  setDraftApiKey: (value) => set({ draftApiKey: value }),
  setDraftModel: (value) => set({ draftModel: value }),
  toggleDraftForce: () => set((state) => ({ draftForce: !state.draftForce })),

  submitRegister: () => {
    const { accounts, draftProviderId, draftLabel, draftConfigDir, draftApiKey, draftModel, draftForce } =
      get();
    const draft: AccountDraft = {
      providerId: draftProviderId,
      label: draftLabel,
      configDir: draftConfigDir,
      apiKey: draftApiKey,
      model: draftModel,
      force: draftForce,
    };
    // The submit button is gated on validateDraft already; re-check so the
    // action is a safe no-op if called while invalid.
    if (validateDraft(draft, accounts) !== null) return;
    const created = registerAccount(draft, accounts);
    if (!created) return;
    set({
      accounts: addAccount(accounts, created),
      selectedLabel: created.label,
      registering: false,
      ...EMPTY_DRAFT,
    });
    useChatStore.getState().say(`Registered agent: ${created.label} (${created.model}).`);
    useNotificationsStore.getState().notify({
      title: "Agent registered",
      detail: `${created.label} · ${created.name}`,
      kind: "transient",
      command: "chat",
    });
  },

  remove: (label) => {
    const { accounts, selectedLabel } = get();
    const target = accounts.find((account) => account.label === label && account.registered);
    if (!target) return;
    set({
      accounts: removeAccount(accounts, label),
      selectedLabel: selectedLabel === label ? null : selectedLabel,
    });
    useChatStore.getState().say(`Removed agent: ${label}.`);
    useNotificationsStore.getState().notify({
      title: "Agent removed",
      detail: label,
      kind: "transient",
      command: "chat",
    });
  },

  test: (label) => {
    const { accounts } = get();
    const target = accounts.find((account) => account.label === label);
    if (!target) return;
    // Deterministic acknowledgement — no real spawn (mirrors `agents test`).
    useChatStore
      .getState()
      .say(`Spawned \`${target.command} --version\` for **${label}** — reachable.`);
  },

  refresh: () => {
    // Re-apply the seeded detection pass deterministically (no wall-clock).
    set({ accounts: SEEDED_ACCOUNTS });
    const summary = SEEDED_ACCOUNTS.filter((account) => account.usable).length;
    useChatStore
      .getState()
      .say(`Re-ran agent detection — ${summary} available, ${SEEDED_ACCOUNTS.length - summary} not detected.`);
  },
}));
